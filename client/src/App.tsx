import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from './lib/socket';
import { RoomDurationMinutes } from './types';
import { HomeScreen } from './components/HomeScreen';
import { PairingScreen } from './components/PairingScreen';
import { TransferDashboard } from './components/TransferDashboard';
import { LockScreen } from './components/LockScreen';

type Screen = 'home' | 'pairing' | 'transfer';

interface Session {
  roomId: string;
  roomToken: string;
  shortCode: string;
  expiresAt: number;
  createdAt: number;
  isInitiator: boolean;
}

interface LockState {
  title: string;
  subtitle: string;
}

function buildRoomLink(roomId: string, roomToken: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('room', roomId);
  url.searchParams.set('token', roomToken);
  return url.toString();
}

function clearUrlParams(): void {
  window.history.replaceState(null, '', window.location.pathname);
}

export default function App() {
  const socket = getSocket();
  const [screen, setScreen] = useState<Screen>('home');
  const [session, setSession] = useState<Session | null>(null);
  const [lock, setLock] = useState<LockState | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const screenRef = useRef<Screen>('home');
  sessionRef.current = session;
  screenRef.current = screen;

  const reset = useCallback(() => {
    setLock(null);
    setSession(null);
    setErrorMessage(null);
    setScreen('home');
    clearUrlParams();
  }, []);

  // Global signaling-adjacent events: room lifecycle and drift correction.
  useEffect(() => {
    function handlePeerJoined() {
      const current = sessionRef.current;
      if (current?.isInitiator && screenRef.current === 'pairing') {
        setScreen('transfer');
      }
    }

    function handlePeerDisconnected() {
      setLock({
        title: 'Eş Bağlantısı Kesildi',
        subtitle: 'Karşı taraf bağlantıyı kapattı. Devam etmek için yeni bir oda oluşturun.',
      });
    }

    function handleRoomExpired() {
      setLock({
        title: 'Bağlantı Süresi Doldu',
        subtitle: 'Oda süresi doldu ve tüm oturum verileri sunucudan silindi.',
      });
    }

    function handleTimeSync(payload: { expiresAt: number; now: number }) {
      setSession((current) => (current ? { ...current, expiresAt: payload.expiresAt } : current));
    }

    socket.on('peer-joined', handlePeerJoined);
    socket.on('peer-disconnected', handlePeerDisconnected);
    socket.on('room-expired', handleRoomExpired);
    socket.on('time-sync', handleTimeSync);

    return () => {
      socket.off('peer-joined', handlePeerJoined);
      socket.off('peer-disconnected', handlePeerDisconnected);
      socket.off('room-expired', handleRoomExpired);
      socket.off('time-sync', handleTimeSync);
    };
  }, [socket]);

  // Auto-join if the app was opened via a QR/shared link (?room=&token=).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    const roomToken = params.get('token');
    if (!roomId || !roomToken) return;

    setJoining(true);
    socket.emit('join-room', { roomId, roomToken }, (response) => {
      setJoining(false);
      clearUrlParams();
      if (!response.ok) {
        setErrorMessage(response.error);
        return;
      }
      setSession({
        roomId: response.roomId,
        roomToken,
        shortCode: '',
        expiresAt: response.expiresAt,
        createdAt: Date.now(),
        isInitiator: response.isInitiator,
      });
      setScreen(response.peerPresent ? 'transfer' : 'pairing');
    });
    // Runs once on mount only — this handles the initial deep-link, not subsequent state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCreateRoom(durationMinutes: RoomDurationMinutes) {
    setErrorMessage(null);
    setCreating(true);
    socket.emit('create-room', { durationMinutes }, (response) => {
      setCreating(false);
      if (!response.ok) {
        setErrorMessage(response.error);
        return;
      }
      setSession({
        roomId: response.roomId,
        roomToken: response.roomToken,
        shortCode: response.shortCode,
        expiresAt: response.expiresAt,
        createdAt: Date.now(),
        isInitiator: true,
      });
      setScreen('pairing');
    });
  }

  function handleJoinByCode(shortCode: string) {
    setErrorMessage(null);
    setJoining(true);
    socket.emit('join-room', { shortCode }, (response) => {
      setJoining(false);
      if (!response.ok) {
        setErrorMessage(response.error);
        return;
      }
      setSession({
        roomId: response.roomId,
        roomToken: '',
        shortCode,
        expiresAt: response.expiresAt,
        createdAt: Date.now(),
        isInitiator: response.isInitiator,
      });
      setScreen(response.peerPresent ? 'transfer' : 'pairing');
    });
  }

  function handleCancelPairing() {
    if (session) socket.emit('leave-room', { roomId: session.roomId });
    reset();
  }

  function handleExpired() {
    if (session) {
      setLock({
        title: 'Bağlantı Süresi Doldu',
        subtitle: 'Oda süresi doldu ve tüm oturum verileri sunucudan silindi.',
      });
    }
  }

  return (
    <>
      {screen === 'home' && (
        <HomeScreen
          onCreateRoom={handleCreateRoom}
          onJoinByCode={handleJoinByCode}
          creating={creating}
          joining={joining}
          errorMessage={errorMessage}
        />
      )}

      {screen === 'pairing' && session && (
        <PairingScreen
          roomLink={buildRoomLink(session.roomId, session.roomToken)}
          shortCode={session.shortCode}
          expiresAt={session.expiresAt}
          createdAt={session.createdAt}
          onCancel={handleCancelPairing}
        />
      )}

      {screen === 'transfer' && session && (
        <TransferDashboard
          key={session.roomId}
          socket={socket}
          roomId={session.roomId}
          isInitiator={session.isInitiator}
          expiresAt={session.expiresAt}
          createdAt={session.createdAt}
          onExpired={handleExpired}
        />
      )}

      {lock && <LockScreen title={lock.title} subtitle={lock.subtitle} onReset={reset} />}
    </>
  );
}
