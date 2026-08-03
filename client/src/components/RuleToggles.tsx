import type { RuleSet } from '@24game/shared';

interface Props {
  rules: RuleSet;
  onChange: (rules: RuleSet) => void;
  disabled: boolean;
}

const ROWS: { key: keyof RuleSet; label: string; blurb: string }[] = [
  {
    key: 'fractions',
    label: 'Fractions',
    blurb: 'ON lets intermediate results be fractions, like 8 / 3',
  },
  {
    key: 'negatives',
    label: 'Negatives',
    blurb: 'ON lets intermediate results drop below zero, like 3 − 8',
  },
];

export function RuleToggles({ rules, onChange, disabled }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-slate-300">Rules</p>
      {ROWS.map((row) => {
        const on = rules[row.key];
        return (
          <button
            key={row.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...rules, [row.key]: !on })}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-700 px-4 py-3 text-left transition disabled:opacity-60"
          >
            <span>
              <span className="block font-semibold">{row.label}</span>
              <span className="block text-xs text-slate-400">{row.blurb}</span>
            </span>
            <span
              className={[
                'flex h-7 w-14 shrink-0 items-center rounded-full p-1 transition',
                on ? 'justify-end bg-emerald-500' : 'justify-start bg-slate-700',
              ].join(' ')}
            >
              <span className="h-5 w-5 rounded-full bg-white" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
