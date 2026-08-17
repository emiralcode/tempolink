// --- Socket.io signaling contract (mirrors server/src/types.ts) ---

export type RoomDurationMinutes = 2 | 5 | 15 | 60;

export const ALLOWED_DURATIONS: { minutes: RoomDurationMinutes; label: string }[] = [
  { minutes: 5, label: '5 dakika' },
  { minutes: 15, label: '15 dakika' },
  { minutes: 60, label: '1 saat' },
  { minutes: 2, label: '2 dakika (test)' },
];

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

export interface CreateRoomPayload {
  durationMinutes: RoomDurationMinutes;
}

export type CreateRoomResponse =
  | {
      ok: true;
      roomId: string;
      roomToken: string;
      shortCode: string;
      expiresAt: number;
      durationMs: number;
    }
  | { ok: false; error: string };

export interface JoinRoomPayload {
  roomId?: string;
  shortCode?: string;
  roomToken?: string;
}

export type JoinRoomResponse =
  | { ok: true; roomId: string; isInitiator: boolean; expiresAt: number; peerPresent: boolean }
  | { ok: false; error: string };

export type SignalData =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit };

export interface SignalPayload {
  roomId: string;
  data: SignalData;
}

// Fire-and-forget telemetry describing a P2P transfer's lifecycle — metadata only
// (name/size/status), sent purely so the server's audit log can record that a transfer
// happened. The file/text bytes themselves never take this path; see useWebRTC.ts —
// they flow exclusively over the WebRTC RTCDataChannel between the two peers.
export type TransferEventKind = 'offered' | 'accepted' | 'rejected' | 'cancelled' | 'completed' | 'error';

export interface TransferEventPayload {
  roomId: string;
  transferId: string;
  event: TransferEventKind;
  direction: 'send' | 'receive';
  fileName: string;
  fileSize: number;
  errorMessage?: string;
}

export interface ServerToClientEvents {
  'peer-joined': () => void;
  'peer-disconnected': () => void;
  'room-expired': (payload: { reason: 'timeout' | 'closed' }) => void;
  signal: (payload: { from: string; data: SignalData }) => void;
  'time-sync': (payload: { expiresAt: number; now: number }) => void;
}

export interface ClientToServerEvents {
  'create-room': (payload: CreateRoomPayload, callback: (response: CreateRoomResponse) => void) => void;
  'join-room': (payload: JoinRoomPayload, callback: (response: JoinRoomResponse) => void) => void;
  signal: (payload: SignalPayload) => void;
  'leave-room': (payload: { roomId: string }) => void;
  'transfer-event': (payload: TransferEventPayload) => void;
}

// --- Data channel control-message protocol (P2P, never touches the server) ---

export type ControlMessage =
  | { kind: 'file-offer'; id: string; name: string; size: number; mime: string }
  | { kind: 'file-accept'; id: string }
  | { kind: 'file-reject'; id: string }
  | { kind: 'file-cancel'; id: string }
  | { kind: 'text'; id: string; text: string; timestamp: number };

// --- UI-facing transfer & chat state ---

export type TransferDirection = 'send' | 'receive';

export type TransferStatus =
  | 'awaiting-approval'
  | 'pending-approval' // incoming, waiting on local user's decision
  | 'transferring'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'error';

export interface TransferRecord {
  id: string;
  direction: TransferDirection;
  name: string;
  size: number;
  mime: string;
  status: TransferStatus;
  progressBytes: number;
  speedBytesPerSec: number;
  errorMessage?: string;
  blobUrl?: string;
}

export interface ChatMessage {
  id: string;
  direction: 'send' | 'receive';
  text: string;
  timestamp: number;
}
