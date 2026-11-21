import { useEffect, useState } from 'react';
import {
  OPS,
  OP_SYMBOL,
  type Card,
  type CombineStep,
  type Op,
  type Suit,
  type TableCard,
} from '@24game/shared';
import { PlayingCard } from './PlayingCard.js';

interface Props {
  /** The four dealt cards, used to recover suits for un-combined cards. */
  dealt: readonly Card[];
  table: readonly TableCard[];
  /** False for spectators — they watch the combines but cannot touch them. */
  interactive: boolean;
  onCombine: (step: CombineStep) => void;
  /** Bumped by the parent whenever the server rejects a combine. */
  errorNonce?: number;
  errorMessage?: string | null;
  /** Card grid columns; 3 keeps a 5-6 card deal on one phone screen. */
  columns?: 2 | 3;
}

export function CombineBoard({
  dealt,
  table,
  interactive,
  onCombine,
  errorNonce = 0,
  errorMessage,
  columns = 2,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingOp, setPendingOp] = useState<Op | null>(null);
  const [shakeNonce, setShakeNonce] = useState(0);

  // A rejected combine clears the half-built move and flashes the board.
  useEffect(() => {
    if (errorNonce > 0) {
      setSelectedId(null);
      setPendingOp(null);
      setShakeNonce((n) => n + 1);
    }
  }, [errorNonce]);

  // Reset the in-progress selection when the table's composition changes (a
  // landed combine, an undo, a new deal) — but not on unrelated state
  // broadcasts, which would yank a card out from under the player mid-move.
  const tableSignature = table.map((c) => c.id).join(',');
  useEffect(() => {
    setSelectedId(null);
    setPendingOp(null);
  }, [tableSignature]);

  const suitOf = (id: string): Suit | null => dealt.find((c) => c.id === id)?.suit ?? null;

  function handleCardClick(card: TableCard) {
    if (!interactive) return;

    if (selectedId === card.id) {
      // Clicking the selected card again de-selects it.
      setSelectedId(null);
      setPendingOp(null);
      return;
    }

    if (selectedId === null || pendingOp === null) {
      setSelectedId(card.id);
      setPendingOp(null);
      return;
    }

    onCombine({ aId: selectedId, op: pendingOp, bId: card.id });
    setSelectedId(null);
    setPendingOp(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={`grid w-full gap-3 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {table.map((card) => (
          <PlayingCard
            key={card.id}
            label={card.label}
            suit={suitOf(card.id)}
            derived={card.derived}
            selected={selectedId === card.id}
            disabled={!interactive}
            onClick={() => handleCardClick(card)}
          />
        ))}
      </div>

      <div
        key={shakeNonce}
        className={`grid grid-cols-4 gap-2 ${shakeNonce > 0 ? 'animate-shake' : ''}`}
      >
        {OPS.map((op) => (
          <button
            key={op}
            type="button"
            disabled={!interactive || selectedId === null}
            onClick={() => setPendingOp(op)}
            className={[
              'h-14 rounded-md text-2xl font-bold transition-colors disabled:opacity-40',
              pendingOp === op
                ? 'bg-ink text-paper'
                : 'bg-tile text-ink hover:bg-line',
            ].join(' ')}
            aria-label={`operator ${op}`}
          >
            {OP_SYMBOL[op]}
          </button>
        ))}
      </div>

      <p role="alert" className="h-5 text-center text-sm font-medium text-bad">{errorMessage ?? ''}</p>

      {interactive && (
        <p className="text-center text-sm text-muted">
          {selectedId === null
            ? 'Tap a card, then an operator, then another card.'
            : pendingOp === null
              ? 'Now pick an operator.'
              : 'Now pick the second card.'}
        </p>
      )}
    </div>
  );
}
