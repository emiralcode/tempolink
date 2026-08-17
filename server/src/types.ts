export type RoomDurationMinutes = 2 | 5 | 15 | 60;

export const ALLOWED_DURATIONS_MINUTES: readonly RoomDurationMinutes[] = [2, 5, 15, 60];

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
  | {
      ok: true;
      roomId: string;
      isInitiator: boolean;
      expiresAt: number;
      peerPresent: boolean;
    }
  | { ok: false; error: string };

export type SignalData =
  | { type: 'offer'; sdp: RTCSessionDescriptionLike }
  | { type: 'answer'; sdp: RTCSessionDescriptionLike }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateLike };

// Minimal structural types so the server does not depend on lib.dom's WebRTC types.
export interface RTCSessionDescriptionLike {
  type: string;
  sdp?: string;
}

export interface RTCIceCandidateLike {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface SignalPayload {
  roomId: string;
  data: SignalData;
}

export interface ServerToClientEvents {
  'peer-joined': () => void;
  'peer-disconnected': () => void;
  'room-expired': (payload: { reason: 'timeout' | 'closed' }) => void;
  signal: (payload: { from: string; data: SignalData }) => void;
  'time-sync': (payload: { expiresAt: number; now: number }) => void;
}

export interface ClientToServerEvents {
  'create-room': (
    payload: CreateRoomPayload,
    callback: (response: CreateRoomResponse) => void
  ) => void;
  'join-room': (
    payload: JoinRoomPayload,
    callback: (response: JoinRoomResponse) => void
  ) => void;
  signal: (payload: SignalPayload) => void;
  'leave-room': (payload: { roomId: string }) => void;
}
