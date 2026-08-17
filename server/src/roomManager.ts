import crypto from 'crypto';

export interface RoomClient {
  socketId: string;
  joinedAt: number;
}

export interface Room {
  id: string;
  token: string;
  shortCode: string;
  createdAt: number;
  expiresAt: number;
  durationMs: number;
  clients: Map<string, RoomClient>;
  timeout: NodeJS.Timeout;
}

export type JoinRoomResult =
  | { ok: true; room: Room; isInitiator: boolean; peerPresent: boolean }
  | { ok: false; error: string };

export type LeaveRoomResult =
  | { destroyed: true; roomId: string; remainingSocketId: null }
  | { destroyed: false; roomId: string; remainingSocketId: string }
  | { destroyed: false; roomId: null; remainingSocketId: null };

const MAX_CLIENTS_PER_ROOM = 2;
const SHORT_CODE_LENGTH = 6;

interface RoomManagerCallbacks {
  onRoomExpired: (room: Room) => void;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private shortCodeToRoomId = new Map<string, string>();
  private socketIdToRoomId = new Map<string, string>();
  private callbacks: RoomManagerCallbacks;

  constructor(callbacks: RoomManagerCallbacks) {
    this.callbacks = callbacks;
  }

  private generateShortCode(): string {
    let code: string;
    do {
      code = crypto.randomInt(0, 10 ** SHORT_CODE_LENGTH).toString().padStart(SHORT_CODE_LENGTH, '0');
    } while (this.shortCodeToRoomId.has(code));
    return code;
  }

  createRoom(durationMs: number): Room {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('hex');
    const shortCode = this.generateShortCode();
    const now = Date.now();
    const expiresAt = now + durationMs;

    const timeout = setTimeout(() => {
      this.expireRoom(id);
    }, durationMs);

    const room: Room = {
      id,
      token,
      shortCode,
      createdAt: now,
      expiresAt,
      durationMs,
      clients: new Map(),
      timeout,
    };

    this.rooms.set(id, room);
    this.shortCodeToRoomId.set(shortCode, id);
    return room;
  }

  private expireRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.callbacks.onRoomExpired(room);
    this.destroyRoom(roomId);
  }

  destroyRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    clearTimeout(room.timeout);
    for (const clientSocketId of room.clients.keys()) {
      this.socketIdToRoomId.delete(clientSocketId);
    }
    this.shortCodeToRoomId.delete(room.shortCode);
    this.rooms.delete(roomId);
  }

  getRoomById(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getRoomByShortCode(shortCode: string): Room | undefined {
    const roomId = this.shortCodeToRoomId.get(shortCode);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  getRoomIdForSocket(socketId: string): string | undefined {
    return this.socketIdToRoomId.get(socketId);
  }

  joinRoom(params: { roomId?: string; shortCode?: string; token?: string }, socketId: string): JoinRoomResult {
    const room = params.roomId
      ? this.getRoomById(params.roomId)
      : params.shortCode
        ? this.getRoomByShortCode(params.shortCode)
        : undefined;

    if (!room) {
      return { ok: false, error: 'Oda bulunamadı ya da süresi dolmuş.' };
    }

    // Joining by direct roomId (e.g. via QR/link) requires the secret token to match.
    if (params.roomId && params.token !== room.token) {
      return { ok: false, error: 'Geçersiz bağlantı jetonu (token).' };
    }

    if (room.clients.has(socketId)) {
      return { ok: true, room, isInitiator: false, peerPresent: room.clients.size > 1 };
    }

    if (room.clients.size >= MAX_CLIENTS_PER_ROOM) {
      return { ok: false, error: 'Bu oda zaten dolu.' };
    }

    const isInitiator = room.clients.size === 0;
    room.clients.set(socketId, { socketId, joinedAt: Date.now() });
    this.socketIdToRoomId.set(socketId, room.id);

    return { ok: true, room, isInitiator, peerPresent: room.clients.size > 1 };
  }

  leaveRoom(socketId: string): LeaveRoomResult {
    const roomId = this.socketIdToRoomId.get(socketId);
    if (!roomId) {
      return { destroyed: false, roomId: null, remainingSocketId: null };
    }

    const room = this.rooms.get(roomId);
    this.socketIdToRoomId.delete(socketId);

    if (!room) {
      return { destroyed: false, roomId: null, remainingSocketId: null };
    }

    room.clients.delete(socketId);

    if (room.clients.size === 0) {
      this.destroyRoom(roomId);
      return { destroyed: true, roomId, remainingSocketId: null };
    }

    const [remaining] = room.clients.keys();
    return { destroyed: false, roomId, remainingSocketId: remaining };
  }

  shutdown(): void {
    for (const room of this.rooms.values()) {
      clearTimeout(room.timeout);
    }
    this.rooms.clear();
    this.shortCodeToRoomId.clear();
    this.socketIdToRoomId.clear();
  }
}
