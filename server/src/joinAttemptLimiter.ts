interface AttemptWindow {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

/**
 * Guards the 6-digit shortCode join path against brute-force guessing.
 * Tracked per socket connection; a fresh connection gets a fresh window,
 * so this is combined with the caller disconnecting offending sockets.
 */
export class JoinAttemptLimiter {
  private attempts = new Map<string, AttemptWindow>();

  registerFailure(socketId: string): { exceeded: boolean } {
    const now = Date.now();
    const existing = this.attempts.get(socketId);

    if (!existing || now - existing.windowStart > WINDOW_MS) {
      this.attempts.set(socketId, { count: 1, windowStart: now });
      return { exceeded: false };
    }

    existing.count += 1;
    return { exceeded: existing.count > MAX_ATTEMPTS_PER_WINDOW };
  }

  clear(socketId: string): void {
    this.attempts.delete(socketId);
  }
}
