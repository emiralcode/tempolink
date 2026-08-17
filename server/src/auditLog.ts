import type { Redis } from 'ioredis';
import { AUDIT_LOG_KEY } from './redisKeys';

// Capped so a long-running server never grows this list unboundedly — this is an
// operational trail (who/when/what-metadata), not a permanent archive.
const AUDIT_LOG_MAX_LENGTH = 5000;

export type AuditEventKind =
  | 'room_created'
  | 'peer_joined'
  | 'peer_left'
  | 'room_closed'
  | 'room_expired'
  | 'transfer_offered'
  | 'transfer_accepted'
  | 'transfer_rejected'
  | 'transfer_cancelled'
  | 'transfer_completed'
  | 'transfer_error';

export interface AuditEventInput {
  kind: AuditEventKind;
  roomId: string;
  [key: string]: unknown;
}

/**
 * Structured, metadata-only history of room and transfer lifecycle events —
 * file names/sizes and status transitions, never file or text content (those never
 * reach the server at all; see useWebRTC.ts's P2P-only data path).
 */
export class AuditLog {
  constructor(private readonly redis: Redis) {}

  async record(event: AuditEventInput): Promise<void> {
    const entry = { ...event, timestamp: Date.now() };
    await this.redis
      .multi()
      .rpush(AUDIT_LOG_KEY, JSON.stringify(entry))
      .ltrim(AUDIT_LOG_KEY, -AUDIT_LOG_MAX_LENGTH, -1)
      .exec();
  }
}
