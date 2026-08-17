import { useEffect, useMemo, useRef, useState } from 'react';

const TICK_MS = 250;
const URGENT_THRESHOLD_MS = 60_000; // last 60 seconds trigger the red alarm state

interface UseCountdownResult {
  remainingMs: number;
  formatted: string;
  isExpired: boolean;
  isUrgent: boolean;
  progressRatio: number; // 1 -> just started, 0 -> expired
}

/**
 * Server-authoritative countdown: expiresAt is corrected periodically via
 * 'time-sync' events from the signaling server, so client clock drift never
 * causes the two peers' timers to diverge.
 */
export function useCountdown(expiresAt: number | null, createdAt: number | null): UseCountdownResult {
  const [now, setNow] = useState(() => Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    intervalRef.current = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [expiresAt]);

  return useMemo(() => {
    if (!expiresAt) {
      return { remainingMs: 0, formatted: '00:00', isExpired: false, isUrgent: false, progressRatio: 1 };
    }

    const remainingMs = Math.max(0, expiresAt - now);
    const isExpired = remainingMs <= 0;
    const isUrgent = !isExpired && remainingMs <= URGENT_THRESHOLD_MS;

    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const totalDurationMs = createdAt ? expiresAt - createdAt : remainingMs;
    const progressRatio = totalDurationMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalDurationMs)) : 0;

    return { remainingMs, formatted, isExpired, isUrgent, progressRatio };
  }, [expiresAt, now, createdAt]);
}
