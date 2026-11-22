import type { ReactNode } from 'react';
import { BackLink, PageLink } from '../components/PageLinks.js';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-2xl font-extrabold">{title}</h2>
      <div className="flex flex-col gap-2 leading-relaxed">{children}</div>
    </section>
  );
}

/** A worked example, one combine per line. */
function Steps({ lines }: { lines: string[] }) {
  return (
    <ol className="panel flex flex-col gap-1 font-display text-lg tabular-nums">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ol>
  );
}

export function HowToPlay({ onHome, onPlay, onSolver }: { onHome: () => void; onPlay: () => void; onSolver: () => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-8 px-5 pb-10 pt-6">
      <header className="flex flex-col gap-2 border-b border-ink pb-4">
        <p className="eyebrow">Rules, examples and tips</p>
        <h1 className="font-display text-4xl font-extrabold">How to play 24</h1>
        <p className="text-muted">
          24 is a quick math card game. Four cards are dealt and you race to make exactly 24 from
          them.
        </p>
      </header>

      <Section title="The rules">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>You get four cards. Ace is 1, Jack is 11, Queen is 12 and King is 13.</li>
          <li>Use every card exactly once.</li>
          <li>Combine them with addition, subtraction, multiplication and division, in any order.</li>
          <li>The result has to be exactly 24.</li>
        </ul>
        <p>
          Not every hand works. Of the 1,820 different four-card hands in a deck, 1,362 can make
          24 when fractions are allowed along the way, and 1,346 with whole numbers only. Spotting that a hand has no answer is a skill too, and in this game you can call it.
        </p>
      </Section>

      <Section title="An example">
        <p>Cards: 4, 7, 8, 8.</p>
        <Steps lines={['8 ÷ 8 = 1', '7 − 1 = 6', '6 × 4 = 24']} />
        <p>Written as one line: (7 − 8 ÷ 8) × 4 = 24.</p>
      </Section>

      <Section title="A harder one">
        <p>
          Cards: 3, 3, 8, 8. There is exactly one way, and it goes through a fraction:
        </p>
        <Steps lines={['8 ÷ 3 = 8/3', '3 − 8/3 = 1/3', '8 ÷ 1/3 = 24']} />
        <p>
          That’s why rooms have a <strong>Fractions</strong> switch. With it off, any division
          has to come out even, and this hand has no answer.
        </p>
      </Section>

      <Section title="Tips">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Think in pairs that make 24: <strong>3 × 8</strong>, <strong>4 × 6</strong>,{' '}
            <strong>2 × 12</strong>, <strong>12 + 12</strong>. Then build the missing number from the
            other two cards.
          </li>
          <li>Two cards that are equal make 1 (divide) or 0 (subtract), which is handy for tidying up.</li>
          <li>Big cards often need subtracting: 13 − 11 = 2, then 2 × 12.</li>
          <li>Stuck after ten seconds? It may have no answer. Fractions are the usual way out.</li>
        </ul>
      </Section>

      <Section title="Playing online here">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong>Buzz in</strong> when you see it. You then have 5 seconds to touch your first card
            and 10 seconds to finish. Tap a card, an operator, then another card to combine them.
          </li>
          <li>
            <strong>No solution</strong>: call it if you think the hand can’t be done. Right, and you
            score. Wrong, and everyone else still in scores.
          </li>
          <li>A failed buzz locks you out of that hand; the others keep going on the same cards.</li>
          <li>A match is 13 hands, one full deck. Rooms take 2 to 10 players, or 2 v 2 teams.</li>
          <li>Ranked matches are 1 v 1 and move your rating. The daily puzzle is the same for everyone.</li>
        </ul>
      </Section>

      <div className="flex flex-col gap-3">
        <button type="button" className="btn-primary h-12" onClick={onPlay}>
          Play 24 now
        </button>
        <PageLink href="/solver" onNavigate={onSolver} className="btn-secondary h-12">
          Check a hand with the solver
        </PageLink>
        <BackLink onHome={onHome} />
      </div>
    </div>
  );
}
