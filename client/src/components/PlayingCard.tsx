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
    'relative flex aspect-[3/4] w-full max-w-[7.5rem] select-none flex-col items-center justify-center ' +
    'rounded-2xl border-2 text-center transition';

  const skin = derived
    ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100 shadow-[0_0_24px_-6px] shadow-emerald-500/60'
    : 'border-slate-300 bg-slate-50 text-slate-900';

  const ring = selected ? 'ring-4 ring-amber-400 -translate-y-2' : '';
  const dim = disabled ? 'opacity-60' : 'hover:-translate-y-1 cursor-pointer';

  const red = suit ? SUIT_IS_RED[suit] : false;

  // Long fractions like 105/8 need to shrink to stay on the card.
  const size = label.length >= 5 ? 'text-2xl' : label.length >= 3 ? 'text-3xl' : 'text-5xl';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={[base, skin, ring, dim, shake ? 'animate-shake' : '', derived ? 'animate-pop' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <span className={`font-bold tabular-nums ${size}`}>{label}</span>
      {suit && !derived && (
        <span className={`mt-1 text-2xl ${red ? 'text-rose-600' : 'text-slate-800'}`}>
          {SUIT_SYMBOL[suit]}
        </span>
      )}
      {derived && <span className="mt-1 text-xs uppercase tracking-wide opacity-70">combined</span>}
    </button>
  );
}
