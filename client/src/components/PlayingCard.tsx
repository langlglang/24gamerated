import { SUIT_IS_RED, SUIT_SYMBOL, type Suit } from '@24game/shared';

interface Props {
  label: string;
  suit?: Suit | null;
  /** Derived cards (combine results) look visibly different from dealt cards. */
  derived?: boolean;
  selected?: boolean;
  disabled?: boolean;
  shake?: boolean;
  onClick?: () => void;
}

const RANK_NAMES: Record<string, string> = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' };
const SUIT_NAMES: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

export function PlayingCard({
  label,
  suit,
  derived = false,
  selected = false,
  disabled = false,
  shake = false,
  onClick,
}: Props) {
  const base =
    'relative flex h-28 w-full select-none items-center justify-center gap-2 rounded-md border-2 ' +
    'border-ink text-center transition sm:h-32 short:h-20';

  const skin = selected ? 'bg-mark -translate-y-1' : derived ? 'bg-tile' : 'bg-card';
  const dim = disabled ? 'cursor-default' : 'cursor-pointer hover:-translate-y-0.5';

  const red = suit ? SUIT_IS_RED[suit] : false;

  // Long fractions like 105/8 need to shrink to stay on the card.
  const size = label.length >= 5 ? 'text-3xl' : label.length >= 3 ? 'text-4xl' : 'text-6xl';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={suit && !derived ? `${RANK_NAMES[label] ?? label} of ${SUIT_NAMES[suit]}` : label}
      className={[base, skin, dim, shake ? 'animate-shake' : '', derived ? 'animate-pop' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <span className={`font-display font-extrabold leading-none tabular-nums ${size}`}>{label}</span>
      {suit && !derived && (
        <span aria-hidden="true" className={`text-2xl leading-none ${red ? 'text-bad' : 'text-ink'}`}>
          {SUIT_SYMBOL[suit]}
        </span>
      )}
      {derived && (
        <span className="absolute bottom-2 left-0 right-0 text-[11px] font-semibold uppercase tracking-widest text-muted">
          combined
        </span>
      )}
    </button>
  );
}
