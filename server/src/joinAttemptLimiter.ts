import type { Redis } from 'ioredis';
import { joinAttemptsKey } from './redisKeys';

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS_PER_WINDOW = 5;

/**
 * Guards the 6-digit shortCode join path against brute-force guessing, using the
 * standard Redis INCR+EXPIRE counter pattern: the first failure in a window opens a
 * fresh TTL, subsequent failures just increment — no separate cleanup job needed.
 */
export class JoinAttemptLimiter {
  constructor(private readonly redis: Redis) {}

  async registerFailure(socketId: string): Promise<{ exceeded: boolean }> {
    const key = joinAttemptsKey(socketId);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }
    return { exceeded: count > MAX_ATTEMPTS_PER_WINDOW };
  }

  async clear(socketId: string): Promise<void> {
    await this.redis.del(joinAttemptsKey(socketId));
  }
}
