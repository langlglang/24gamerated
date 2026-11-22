import { useMemo, useState } from 'react';
import { allSolutions, type RuleSet } from '@24game/shared';
import { RuleToggles } from '../components/RuleToggles.js';
import { BackLink, PageLink } from '../components/PageLinks.js';

const SHOWN_AT_FIRST = 12;
const MAX_VALUE = 99;

/** "8 / (3 - 8 / 3)" → "8 ÷ (3 − 8 ÷ 3)" */
const pretty = (expr: string) => expr.replace(/\*/g, '×').replace(/\//g, '÷').replace(/ - /g, ' − ');

function parse(raw: string): number | null {
  if (!/^\d{1,2}$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_VALUE ? n : null;
}

export function Solver({ onHome, onHowTo }: { onHome: () => void; onHowTo: () => void }) {
  const [raw, setRaw] = useState(['4', '7', '8', '8']);
  const [rules, setRules] = useState<RuleSet>({ fractions: false, negatives: false });
  const [showAll, setShowAll] = useState(false);

  const values = raw.map(parse);
  const complete = values.every((v): v is number => v !== null);

  const solutions = useMemo(() => {
    if (!values.every((v): v is number => v !== null)) return null;
    // Simplest first: shorter expressions read more easily.
    return allSolutions(values, rules, 200).sort((a, b) => a.length - b.length || a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw.join(','), rules.fractions, rules.negatives]);

  // With nothing found, say whether allowing fractions would help. (Allowing
  // negatives never turns an impossible hand into a possible one.)
  const fractionsWouldHelp = useMemo(
    () =>
      solutions !== null &&
      solutions.length === 0 &&
      !rules.fractions &&
      allSolutions(values as number[], { fractions: true, negatives: true }, 1).length > 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [solutions, rules.fractions],
  );

  const shown = solutions && !showAll ? solutions.slice(0, SHOWN_AT_FIRST) : solutions;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-5 pb-10 pt-6">
      <header className="flex flex-col gap-2 border-b border-ink pb-4">
        <p className="eyebrow">Every answer, any hand</p>
        <h1 className="font-display text-4xl font-extrabold">24 solver</h1>
        <p className="text-muted">Type four numbers to see every way to make 24 with +, −, × and ÷.</p>
      </header>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">Your four numbers (1 to 99)</legend>
        <div className="grid grid-cols-4 gap-3">
          {raw.map((value, i) => (
            <input
              key={i}
              aria-label={`Number ${i + 1}`}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              autoComplete="off"
              className="field h-16 text-center font-display text-3xl font-extrabold"
              aria-invalid={value !== '' && parse(value) === null ? true : undefined}
              value={value}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const next = [...raw];
                next[i] = e.target.value.replace(/\D/g, '');
                setRaw(next);
                setShowAll(false);
              }}
            />
          ))}
        </div>
        <p className="text-xs text-muted">Cards: Ace = 1, Jack = 11, Queen = 12, King = 13.</p>
      </fieldset>

      <RuleToggles rules={rules} onChange={(r) => { setRules(r); setShowAll(false); }} disabled={false} />

      <section aria-live="polite" className="flex flex-col gap-3">
        {!complete ? (
          <p className="text-muted">Fill in all four boxes with whole numbers from 1 to 99.</p>
        ) : solutions && solutions.length === 0 ? (
          <div className="panel">
            <p className="font-display text-2xl font-extrabold">No solution</p>
            <p className="mt-1 text-sm text-muted">
              {fractionsWouldHelp
                ? `There’s no way to make 24 from ${values.join(', ')} with whole numbers. Turn Fractions on to see the answer.`
                : `There’s no way to make 24 from ${values.join(', ')}, even with fractions and negatives.`}
            </p>
          </div>
        ) : solutions ? (
          <>
            <p className="font-display text-2xl font-extrabold">
              {solutions.length >= 200 ? '200+' : solutions.length} {solutions.length === 1 ? 'solution' : 'solutions'}
            </p>
            <ul className="panel flex flex-col divide-y divide-line p-0">
              {shown!.map((s) => (
                <li key={s} className="px-4 py-2 font-display text-lg tabular-nums">
                  {pretty(s)} = 24
                </li>
              ))}
            </ul>
            {!showAll && solutions.length > SHOWN_AT_FIRST && (
              <button type="button" className="btn-secondary h-12" onClick={() => setShowAll(true)}>
                Show all {solutions.length >= 200 ? '200+' : solutions.length}
              </button>
            )}
          </>
        ) : null}
      </section>

      <div className="flex flex-col gap-3">
        <PageLink href="/how-to-play" onNavigate={onHowTo} className="btn-secondary h-12">
          How to play 24
        </PageLink>
        <BackLink onHome={onHome} />
      </div>
    </div>
  );
}
