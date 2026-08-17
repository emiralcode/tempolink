import crypto from 'crypto';
import type { Redis } from 'ioredis';
import { ACTIVE_ROOMS_SET_KEY, STATS_TOTAL_ROOMS_KEY, roomKey, shortCodeKey, socketKey } from './redisKeys';

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
  clients: RoomClient[];
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
const SHORT_CODE_GENERATION_ATTEMPTS = 10;

function ttlSecondsUntil(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

/**
 * Room state lives in Redis (not process memory), with each room's TTL set to match
 * its self-destruct deadline exactly. Redis's own key expiry is what actually tears a
 * room down (see redis.ts / index.ts's keyspace-notification subscriber) — this class
 * is a thin, consistent read/write layer over that store, plus the bookkeeping (active
 * room index, creation counter) that per-key TTL alone cannot express.
 */
export class RoomManager {
  constructor(private readonly redis: Redis) {}

  private async generateUniqueShortCode(): Promise<string> {
    for (let attempt = 0; attempt < SHORT_CODE_GENERATION_ATTEMPTS; attempt++) {
      const code = crypto
        .randomInt(0, 10 ** SHORT_CODE_LENGTH)
        .toString()
        .padStart(SHORT_CODE_LENGTH, '0');
      const exists = await this.redis.exists(shortCodeKey(code));
      if (!exists) return code;
    }
    throw new Error('Benzersiz oda kodu üretilemedi, lütfen tekrar deneyin.');
  }

  async createRoom(durationMs: number): Promise<Room> {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('hex');
    const shortCode = await this.generateUniqueShortCode();
    const now = Date.now();

    const room: Room = {
      id,
      token,
      shortCode,
      createdAt: now,
      expiresAt: now + durationMs,
      durationMs,
      clients: [],
    };

    const ttl = Math.ceil(durationMs / 1000);
    await this.redis
      .multi()
      .set(roomKey(id), JSON.stringify(room), 'EX', ttl)
      .set(shortCodeKey(shortCode), id, 'EX', ttl)
      .sadd(ACTIVE_ROOMS_SET_KEY, id)
      .incr(STATS_TOTAL_ROOMS_KEY)
      .exec();

    return room;
  }

  async getRoomById(roomId: string): Promise<Room | null> {
    const raw = await this.redis.get(roomKey(roomId));
    return raw ? (JSON.parse(raw) as Room) : null;
  }

  async getRoomIdByShortCode(shortCode: string): Promise<string | null> {
    return this.redis.get(shortCodeKey(shortCode));
  }

  async getRoomIdForSocket(socketId: string): Promise<string | null> {
    return this.redis.get(socketKey(socketId));
  }

  private async saveRoom(room: Room): Promise<void> {
    await this.redis.set(roomKey(room.id), JSON.stringify(room), 'EX', ttlSecondsUntil(room.expiresAt));
  }

  async joinRoom(
    params: { roomId?: string; shortCode?: string; token?: string },
    socketId: string
  ): Promise<JoinRoomResult> {
    const roomId = params.roomId ?? (params.shortCode ? await this.getRoomIdByShortCode(params.shortCode) : null);
    if (!roomId) {
      return { ok: false, error: 'Oda bulunamadı ya da süresi dolmuş.' };
    }

    const room = await this.getRoomById(roomId);
    if (!room) {
      return { ok: false, error: 'Oda bulunamadı ya da süresi dolmuş.' };
    }

    // Joining by direct roomId (e.g. via QR/link) requires the secret token to match.
    if (params.roomId && params.token !== room.token) {
      return { ok: false, error: 'Geçersiz bağlantı jetonu (token).' };
    }

    if (room.clients.some((client) => client.socketId === socketId)) {
      return { ok: true, room, isInitiator: false, peerPresent: room.clients.length > 1 };
    }

    if (room.clients.length >= MAX_CLIENTS_PER_ROOM) {
      return { ok: false, error: 'Bu oda zaten dolu.' };
    }

    const isInitiator = room.clients.length === 0;
    room.clients.push({ socketId, joinedAt: Date.now() });

    const ttl = ttlSecondsUntil(room.expiresAt);
    await this.redis
      .multi()
      .set(roomKey(room.id), JSON.stringify(room), 'EX', ttl)
      .set(socketKey(socketId), room.id, 'EX', ttl)
      .exec();

    return { ok: true, room, isInitiator, peerPresent: room.clients.length > 1 };
  }

  async leaveRoom(socketId: string): Promise<LeaveRoomResult> {
    const roomId = await this.getRoomIdForSocket(socketId);
    await this.redis.del(socketKey(socketId));
    if (!roomId) {
      return { destroyed: false, roomId: null, remainingSocketId: null };
    }

    const room = await this.getRoomById(roomId);
    if (!room) {
      return { destroyed: false, roomId: null, remainingSocketId: null };
    }

    room.clients = room.clients.filter((client) => client.socketId !== socketId);

    if (room.clients.length === 0) {
      await this.destroyRoom(room);
      return { destroyed: true, roomId, remainingSocketId: null };
    }

    await this.saveRoom(room);
    return { destroyed: false, roomId, remainingSocketId: room.clients[0].socketId };
  }

  /** Explicit teardown (both peers gone, or the pairing screen was cancelled). */
  async destroyRoom(room: Room): Promise<void> {
    const pipeline = this.redis
      .multi()
      .del(roomKey(room.id))
      .del(shortCodeKey(room.shortCode))
      .srem(ACTIVE_ROOMS_SET_KEY, room.id);
    for (const client of room.clients) {
      pipeline.del(socketKey(client.socketId));
    }
    await pipeline.exec();
  }

  /**
   * Called from the Redis keyspace 'expired' notification. By the time that event
   * fires, Redis has already deleted `room:{id}` — the payload is gone — so this only
   * performs the bookkeeping TTL alone can't express (the active-room set has no
   * per-member expiry). The caller derives roomId straight from the expired key name.
   */
  async cleanupExpiredRoomId(roomId: string): Promise<void> {
    await this.redis.srem(ACTIVE_ROOMS_SET_KEY, roomId);
  }

  async getActiveRoomCount(): Promise<number> {
    return this.redis.scard(ACTIVE_ROOMS_SET_KEY);
  }

  async getTotalRoomsCreated(): Promise<number> {
    const value = await this.redis.get(STATS_TOTAL_ROOMS_KEY);
    return value ? Number(value) : 0;
  }
}
