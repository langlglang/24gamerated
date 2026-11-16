import { useEffect, useRef, useState } from 'react';
import type { TimerView } from '@24game/shared';

/**
 * The server owns timeouts. This only interpolates between broadcasts so the
 * number on screen moves smoothly; it never decides that time is up.
 */
export function useCountdown(timer: TimerView | null): number {
  const [remaining, setRemaining] = useState(timer?.remainingMs ?? 0);
  const anchor = useRef({ receivedAt: 0, remainingMs: 0 });

  useEffect(() => {
    if (!timer) {
      setRemaining(0);
      return;
    }
    anchor.current = { receivedAt: performance.now(), remainingMs: timer.remainingMs };
    setRemaining(timer.remainingMs);

    let frame = 0;
    const tick = () => {
      const elapsed = performance.now() - anchor.current.receivedAt;
      setRemaining(Math.max(anchor.current.remainingMs - elapsed, 0));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // endsAt identifies a specific timer instance; remainingMs alone would
    // re-anchor on every broadcast.
  }, [timer?.endsAt, timer?.kind, timer?.remainingMs]);

  return remaining;
}

const LABELS: Record<TimerView['kind'], string> = {
  'buzz-start': 'Touch a card',
  answer: 'Finish the combine',
  'hand-idle': 'Hand time',
  result: 'Next hand',
};

export function CountdownBar({ timer }: { timer: TimerView | null }) {
  const remaining = useCountdown(timer);
  if (!timer) return null;

  const pct = Math.max(0, Math.min(100, (remaining / timer.durationMs) * 100));
  const urgent = timer.kind === 'buzz-start' || timer.kind === 'answer';
  const color = urgent && pct < 34 ? 'bg-bad' : 'bg-ink';

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between text-xs text-muted">
        <span>{LABELS[timer.kind]}</span>
        <span className={`font-semibold tabular-nums ${urgent && pct < 34 ? 'text-bad' : 'text-ink'}`}>
          {(remaining / 1000).toFixed(1)}s
        </span>
      </div>
      <div
        className="h-1 w-full bg-line"
        role="progressbar"
        aria-label={LABELS[timer.kind]}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
