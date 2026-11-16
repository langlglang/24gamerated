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
      <p className="text-sm font-semibold">Rules</p>
      {ROWS.map((row) => {
        const on = rules[row.key];
        return (
          <button
            key={row.key}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange({ ...rules, [row.key]: !on })}
            className="flex w-full items-center justify-between gap-3 rounded-md border border-line px-4 py-3 text-left transition disabled:opacity-60"
          >
            <span>
              <span className="block font-semibold">{row.label}</span>
              <span className="block text-xs text-muted">{row.blurb}</span>
            </span>
            <span
              className={[
                'flex h-7 w-14 shrink-0 items-center rounded-full p-1 transition',
                on ? 'justify-end bg-ink' : 'justify-start bg-muted',
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
