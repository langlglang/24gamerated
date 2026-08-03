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
  const color = !urgent ? 'bg-slate-500' : pct < 34 ? 'bg-rose-500' : 'bg-amber-400';

  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between text-xs text-slate-400">
        <span>{LABELS[timer.kind]}</span>
        <span className="tabular-nums font-semibold text-slate-200">
          {(remaining / 1000).toFixed(1)}s
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-[width] duration-75 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
