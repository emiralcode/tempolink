import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  ChatMessage,
  ClientToServerEvents,
  ControlMessage,
  MAX_FILE_SIZE_BYTES,
  ServerToClientEvents,
  SignalData,
  TransferRecord,
} from '../types';

const CHUNK_SIZE = 64 * 1024; // 64 KB
const BUFFERED_AMOUNT_THRESHOLD = 1024 * 1024; // 1 MB backpressure watermark
const SPEED_SAMPLE_INTERVAL_MS = 150;

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
if (import.meta.env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: import.meta.env.VITE_TURN_URL,
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  });
}

interface ReceivingState {
  id: string;
  name: string;
  size: number;
  mime: string;
  chunks: ArrayBuffer[];
  receivedBytes: number;
  lastTick: number;
  lastBytes: number;
}

interface IncomingOfferMeta {
  name: string;
  size: number;
  mime: string;
}

export type PeerConnectionState = RTCPeerConnectionState | 'idle';
export type DataChannelUiState = RTCDataChannelState | 'idle';

interface UseWebRTCParams {
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;
  roomId: string | null;
  isInitiator: boolean;
  enabled: boolean;
}

function sendControl(dc: RTCDataChannel, msg: ControlMessage): void {
  dc.send(JSON.stringify(msg));
}

function waitForBufferedAmountLow(dc: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    const onLow = () => {
      dc.removeEventListener('bufferedamountlow', onLow);
      resolve();
    };
    dc.addEventListener('bufferedamountlow', onLow);
  });
}

export function useWebRTC({ socket, roomId, isInitiator, enabled }: UseWebRTCParams) {
  const [connectionState, setConnectionState] = useState<PeerConnectionState>('idle');
  const [channelState, setChannelState] = useState<DataChannelUiState>('idle');
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [incomingRequestId, setIncomingRequestId] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  const outgoingFilesRef = useRef<Map<string, File>>(new Map());
  const outgoingQueueRef = useRef<string[]>([]);
  const activeOutgoingIdRef = useRef<string | null>(null);
  const cancelledIdsRef = useRef<Set<string>>(new Set());

  const incomingOffersRef = useRef<Map<string, IncomingOfferMeta>>(new Map());
  const receivingStateRef = useRef<ReceivingState | null>(null);

  const addTransfer = useCallback((record: TransferRecord) => {
    setTransfers((prev) => [...prev, record]);
  }, []);

  const updateTransfer = useCallback((id: string, patch: Partial<TransferRecord>) => {
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const processSendQueue = useCallback(() => {
    if (activeOutgoingIdRef.current) return;
    const nextId = outgoingQueueRef.current.shift();
    if (!nextId) return;
    const file = outgoingFilesRef.current.get(nextId);
    const dc = dcRef.current;
    if (!file || !dc || dc.readyState !== 'open') return;

    activeOutgoingIdRef.current = nextId;
    updateTransfer(nextId, { status: 'awaiting-approval' });
    sendControl(dc, {
      kind: 'file-offer',
      id: nextId,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
    });
  }, [updateTransfer]);

  const beginSendingFile = useCallback(
    async (id: string) => {
      const dc = dcRef.current;
      const file = outgoingFilesRef.current.get(id);
      if (!dc || !file) return;

      updateTransfer(id, { status: 'transferring', progressBytes: 0, speedBytesPerSec: 0 });

      let offset = 0;
      let lastTick = performance.now();
      let lastBytes = 0;

      try {
        while (offset < file.size) {
          if (cancelledIdsRef.current.has(id)) {
            cancelledIdsRef.current.delete(id);
            return;
          }
          if (dc.readyState !== 'open') {
            updateTransfer(id, { status: 'error', errorMessage: 'Bağlantı kesildi.' });
            return;
          }
          if (dc.bufferedAmount > BUFFERED_AMOUNT_THRESHOLD) {
            await waitForBufferedAmountLow(dc);
          }

          const slice = file.slice(offset, offset + CHUNK_SIZE);
          const buffer = await slice.arrayBuffer();
          dc.send(buffer);
          offset += buffer.byteLength;

          const now = performance.now();
          if (now - lastTick > SPEED_SAMPLE_INTERVAL_MS || offset >= file.size) {
            const elapsedSec = (now - lastTick) / 1000 || 1;
            const speed = (offset - lastBytes) / elapsedSec;
            updateTransfer(id, { progressBytes: offset, speedBytesPerSec: speed });
            lastTick = now;
            lastBytes = offset;
          }
        }
        updateTransfer(id, { status: 'completed', progressBytes: file.size, speedBytesPerSec: 0 });
      } finally {
        outgoingFilesRef.current.delete(id);
        activeOutgoingIdRef.current = null;
        processSendQueue();
      }
    },
    [updateTransfer, processSendQueue]
  );

  const handleBinaryChunk = useCallback(
    (buffer: ArrayBuffer) => {
      const receiving = receivingStateRef.current;
      if (!receiving) return;

      receiving.chunks.push(buffer);
      receiving.receivedBytes += buffer.byteLength;

      const now = performance.now();
      if (now - receiving.lastTick > SPEED_SAMPLE_INTERVAL_MS || receiving.receivedBytes >= receiving.size) {
        const elapsedSec = (now - receiving.lastTick) / 1000 || 1;
        const speed = (receiving.receivedBytes - receiving.lastBytes) / elapsedSec;
        updateTransfer(receiving.id, { progressBytes: receiving.receivedBytes, speedBytesPerSec: speed });
        receiving.lastTick = now;
        receiving.lastBytes = receiving.receivedBytes;
      }

      if (receiving.receivedBytes >= receiving.size) {
        const blob = new Blob(receiving.chunks, { type: receiving.mime || 'application/octet-stream' });
        const blobUrl = URL.createObjectURL(blob);
        updateTransfer(receiving.id, {
          status: 'completed',
          progressBytes: receiving.size,
          speedBytesPerSec: 0,
          blobUrl,
        });
        incomingOffersRef.current.delete(receiving.id);
        receivingStateRef.current = null;
      }
    },
    [updateTransfer]
  );

  const handleControlMessage = useCallback(
    (msg: ControlMessage) => {
      switch (msg.kind) {
        case 'file-offer': {
          const dc = dcRef.current;
          if (msg.size > MAX_FILE_SIZE_BYTES) {
            // Defense-in-depth: reject even if a tampered peer client bypassed its own UI check.
            if (dc) sendControl(dc, { kind: 'file-reject', id: msg.id });
            addTransfer({
              id: msg.id,
              direction: 'receive',
              name: msg.name,
              size: msg.size,
              mime: msg.mime,
              status: 'error',
              progressBytes: 0,
              speedBytesPerSec: 0,
              errorMessage: 'Dosya 100MB sınırını aşıyor, otomatik olarak reddedildi.',
            });
            return;
          }
          incomingOffersRef.current.set(msg.id, { name: msg.name, size: msg.size, mime: msg.mime });
          addTransfer({
            id: msg.id,
            direction: 'receive',
            name: msg.name,
            size: msg.size,
            mime: msg.mime,
            status: 'pending-approval',
            progressBytes: 0,
            speedBytesPerSec: 0,
          });
          setIncomingRequestId(msg.id);
          return;
        }
        case 'file-accept': {
          if (activeOutgoingIdRef.current !== msg.id) return;
          void beginSendingFile(msg.id);
          return;
        }
        case 'file-reject': {
          updateTransfer(msg.id, { status: 'rejected' });
          outgoingFilesRef.current.delete(msg.id);
          if (activeOutgoingIdRef.current === msg.id) {
            activeOutgoingIdRef.current = null;
            processSendQueue();
          }
          return;
        }
        case 'file-cancel': {
          updateTransfer(msg.id, { status: 'cancelled' });
          if (receivingStateRef.current?.id === msg.id) {
            receivingStateRef.current = null;
          }
          if (activeOutgoingIdRef.current === msg.id) {
            cancelledIdsRef.current.add(msg.id);
          }
          return;
        }
        case 'text': {
          setMessages((prev) => [...prev, { id: msg.id, direction: 'receive', text: msg.text, timestamp: msg.timestamp }]);
          return;
        }
        default:
          return;
      }
    },
    [addTransfer, updateTransfer, beginSendingFile, processSendQueue]
  );

  // --- Peer connection lifecycle: created once per (roomId, isInitiator) session ---
  useEffect(() => {
    if (!enabled || !socket || !roomId) return;

    let cancelled = false;
    const pendingCandidates: RTCIceCandidateInit[] = [];

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    setConnectionState(pc.connectionState);

    pc.onconnectionstatechange = () => {
      if (!cancelled) setConnectionState(pc.connectionState);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', { roomId, data: { type: 'ice-candidate', candidate: event.candidate.toJSON() } });
      }
    };

    function setupDataChannel(dc: RTCDataChannel) {
      dc.binaryType = 'arraybuffer';
      dc.bufferedAmountLowThreshold = BUFFERED_AMOUNT_THRESHOLD;
      dcRef.current = dc;
      dc.onopen = () => !cancelled && setChannelState('open');
      dc.onclose = () => !cancelled && setChannelState('closed');
      dc.onerror = () => !cancelled && setChannelState('closed');
      dc.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (typeof event.data === 'string') {
          handleControlMessage(JSON.parse(event.data) as ControlMessage);
        } else {
          handleBinaryChunk(event.data as ArrayBuffer);
        }
      };
    }

    if (isInitiator) {
      setupDataChannel(pc.createDataChannel('data'));
    } else {
      pc.ondatachannel = (event) => setupDataChannel(event.channel);
    }

    async function flushPendingCandidates() {
      while (pendingCandidates.length) {
        const candidate = pendingCandidates.shift()!;
        await pc.addIceCandidate(candidate).catch(() => undefined);
      }
    }

    async function createAndSendOffer() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket!.emit('signal', { roomId: roomId!, data: { type: 'offer', sdp: offer } });
    }

    async function handleSignal({ data }: { from: string; data: SignalData }) {
      if (data.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushPendingCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket!.emit('signal', { roomId: roomId!, data: { type: 'answer', sdp: answer } });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushPendingCandidates();
      } else if (data.type === 'ice-candidate') {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(data.candidate).catch(() => undefined);
        } else {
          pendingCandidates.push(data.candidate);
        }
      }
    }

    socket.on('signal', handleSignal);

    if (isInitiator) {
      // By the time this hook is active, the room is already confirmed to hold both
      // peers (that confirmation is what caused the caller to mount this hook), so the
      // offer is created immediately rather than waiting on a 'peer-joined' event —
      // that event may have already fired (and been consumed elsewhere) before this
      // effect's own listener had a chance to subscribe.
      void createAndSendOffer();
    }

    return () => {
      cancelled = true;
      socket.off('signal', handleSignal);
      if (dcRef.current) {
        dcRef.current.onmessage = null;
        dcRef.current.close();
        dcRef.current = null;
      }
      pc.close();
      pcRef.current = null;
      setConnectionState('idle');
      setChannelState('idle');
    };
  }, [enabled, socket, roomId, isInitiator, handleControlMessage, handleBinaryChunk]);

  const sendFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        const id = crypto.randomUUID();
        if (file.size > MAX_FILE_SIZE_BYTES) {
          addTransfer({
            id,
            direction: 'send',
            name: file.name,
            size: file.size,
            mime: file.type || 'application/octet-stream',
            status: 'error',
            progressBytes: 0,
            speedBytesPerSec: 0,
            errorMessage: 'Dosya 100MB sınırını aşıyor.',
          });
          continue;
        }
        addTransfer({
          id,
          direction: 'send',
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
          status: 'awaiting-approval',
          progressBytes: 0,
          speedBytesPerSec: 0,
        });
        outgoingFilesRef.current.set(id, file);
        outgoingQueueRef.current.push(id);
      }
      processSendQueue();
    },
    [addTransfer, processSendQueue]
  );

  const sendText = useCallback((text: string) => {
    const dc = dcRef.current;
    const trimmed = text.trim();
    if (!dc || dc.readyState !== 'open' || !trimmed) return;
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    sendControl(dc, { kind: 'text', id, text: trimmed, timestamp });
    setMessages((prev) => [...prev, { id, direction: 'send', text: trimmed, timestamp }]);
  }, []);

  const acceptTransfer = useCallback(
    (id: string) => {
      const dc = dcRef.current;
      const meta = incomingOffersRef.current.get(id);
      if (!dc || !meta) return;

      receivingStateRef.current = {
        id,
        name: meta.name,
        size: meta.size,
        mime: meta.mime,
        chunks: [],
        receivedBytes: 0,
        lastTick: performance.now(),
        lastBytes: 0,
      };
      updateTransfer(id, { status: 'transferring' });
      sendControl(dc, { kind: 'file-accept', id });
      setIncomingRequestId((current) => (current === id ? null : current));
    },
    [updateTransfer]
  );

  const rejectTransfer = useCallback(
    (id: string) => {
      const dc = dcRef.current;
      updateTransfer(id, { status: 'rejected' });
      incomingOffersRef.current.delete(id);
      if (dc && dc.readyState === 'open') sendControl(dc, { kind: 'file-reject', id });
      setIncomingRequestId((current) => (current === id ? null : current));
    },
    [updateTransfer]
  );

  const cancelTransfer = useCallback(
    (id: string) => {
      const dc = dcRef.current;
      if (activeOutgoingIdRef.current === id) {
        cancelledIdsRef.current.add(id);
      }
      if (receivingStateRef.current?.id === id) {
        receivingStateRef.current = null;
      }
      outgoingFilesRef.current.delete(id);
      outgoingQueueRef.current = outgoingQueueRef.current.filter((x) => x !== id);
      updateTransfer(id, { status: 'cancelled' });
      if (dc && dc.readyState === 'open') sendControl(dc, { kind: 'file-cancel', id });
    },
    [updateTransfer]
  );

  const incomingRequest = useMemo(
    () => transfers.find((t) => t.id === incomingRequestId) ?? null,
    [transfers, incomingRequestId]
  );

  return {
    connectionState,
    channelState,
    transfers,
    messages,
    incomingRequest,
    sendFiles,
    sendText,
    acceptTransfer,
    rejectTransfer,
    cancelTransfer,
  };
}
