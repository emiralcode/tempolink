// Central Redis key schema so every module addresses the same keyspace consistently.
// The 'expired' keyspace-notification handler in index.ts also depends on ROOM_KEY_PREFIX
// to recognize which expired key corresponds to a room (see redis.ts / index.ts).

export const ROOM_KEY_PREFIX = 'room:';
export const SHORTCODE_KEY_PREFIX = 'shortcode:';
export const SOCKET_KEY_PREFIX = 'socket:';
export const JOIN_ATTEMPTS_KEY_PREFIX = 'joinattempts:';

export const ACTIVE_ROOMS_SET_KEY = 'rooms:active';
export const STATS_TOTAL_ROOMS_KEY = 'stats:total_rooms_created';
export const AUDIT_LOG_KEY = 'audit:log';

export const roomKey = (roomId: string): string => `${ROOM_KEY_PREFIX}${roomId}`;
export const shortCodeKey = (shortCode: string): string => `${SHORTCODE_KEY_PREFIX}${shortCode}`;
export const socketKey = (socketId: string): string => `${SOCKET_KEY_PREFIX}${socketId}`;
export const joinAttemptsKey = (socketId: string): string => `${JOIN_ATTEMPTS_KEY_PREFIX}${socketId}`;

export function roomIdFromExpiredKey(expiredKey: string): string | null {
  return expiredKey.startsWith(ROOM_KEY_PREFIX) ? expiredKey.slice(ROOM_KEY_PREFIX.length) : null;
}
