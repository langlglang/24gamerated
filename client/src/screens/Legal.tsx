/**
 * Privacy policy and terms. Written to match what the code actually does
 * (see the README). TEMPLATE: fill in the [BRACKETED] details and have the text
 * reviewed before relying on it. This is not legal advice.
 */
const CONTACT = '[CONTACT EMAIL]';
const OPERATOR = '[YOUR NAME OR ORGANISATION]';
const EFFECTIVE = '[DATE]';
const LAW = '[STATE / COUNTRY]';

function Back({ onHome }: { onHome: () => void }) {
  return (
    <a
      href="/"
      className="btn-secondary h-12"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onHome();
      }}
    >
      Back to the game
    </a>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-xl font-extrabold">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

export function Legal({ doc, onHome }: { doc: 'privacy' | 'terms'; onHome: () => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-5 pb-10 pt-6">
      <header className="flex flex-col gap-1 border-b border-ink pb-4">
        <p className="eyebrow">24game.online</p>
        <h1 className="font-display text-4xl font-extrabold">
          {doc === 'privacy' ? 'Privacy policy' : 'Terms of use'}
        </h1>
        <p className="text-sm text-muted">Effective {EFFECTIVE}</p>
      </header>
      {doc === 'privacy' ? <Privacy /> : <Terms />}
      <Back onHome={onHome} />
    </div>
  );
}

function Privacy() {
  return (
    <>
      <Section title="Who we are">
        <p>
          24game.online (“24”) is run by {OPERATOR}. Questions or requests about your data:{' '}
          {CONTACT}.
        </p>
      </Section>
      <Section title="What we collect">
        <p>
          <strong>Playing as a guest:</strong> no account is needed. We don’t ask for your name or
          email. The display name you type in a room is shown to the other players in that room
          and isn’t kept after the room closes.
        </p>
        <p>
          <strong>If you create an account:</strong> your email address, your username, and your
          password, stored only as a one-way bcrypt hash we can’t read. We also keep your rating,
          your rated match history, and your daily puzzle solve times.
        </p>
        <p>
          <strong>Technical data:</strong> your IP address, used briefly to limit abuse (for
          example, too many sign-in attempts), and server logs kept by our host. If something
          crashes in your browser, the page may send us the error message, the page address and
          your browser type.
        </p>
        <p>
          <strong>On your device:</strong> the game stores your sign-in token, your current game
          seat and your daily puzzle progress in your browser’s local storage, so a refresh doesn’t
          lose your place. We don’t use advertising or tracking cookies.
        </p>
      </Section>
      <Section title="How we use it">
        <p>
          To run the game: sign you in, match you with opponents, keep ratings and the leaderboard,
          show the daily puzzle results, send password-reset emails you ask for, and keep the
          service secure. We don’t sell your data or use it for advertising.
        </p>
      </Section>
      <Section title="Who else sees it">
        <p>
          Other players see your username, rating and results. Your email is never shown. We use
          a few service providers to run the game: Render (hosting), Neon (database), Resend
          (password-reset emails), Google Fonts (the typeface, which your browser loads from
          Google) and, if enabled, Sentry (error reports). They process data only to provide
          their service to us.
        </p>
      </Section>
      <Section title="How long we keep it">
        <p>
          Account data is kept while your account exists. Password-reset links expire after 30
          minutes and are deleted after a day. Server logs are kept for as long as our host
          retains them.
        </p>
      </Section>
      <Section title="Your choices">
        <p>
          You can ask us to see, correct or delete your account data by emailing {CONTACT} from
          the address on your account. Deleting your account removes it along with your rating,
          your match history and your daily puzzle results.
        </p>
      </Section>
      <Section title="Children">
        <p>
          Accounts are not intended for children under 13, and we don’t knowingly collect their
          personal information. Anyone can play as a guest without giving personal information.
          If you believe a child under 13 has created an account, contact us and we’ll delete it.
        </p>
      </Section>
      <Section title="Changes">
        <p>If we change this policy, we’ll update the date at the top of this page.</p>
      </Section>
    </>
  );
}

function Terms() {
  return (
    <>
      <Section title="The game">
        <p>
          24 is a free online game run by {OPERATOR}. By playing or creating an account you agree
          to these terms. If you don’t agree, please don’t use the game.
        </p>
      </Section>
      <Section title="Your account">
        <p>
          Keep your password to yourself; you’re responsible for what happens on your account.
          Pick a username that isn’t offensive or pretending to be someone else. Accounts are for
          people 13 and older.
        </p>
      </Section>
      <Section title="Fair play">
        <p>
          Don’t cheat, use bots or scripts, exploit bugs, harass other players, try to break or
          overload the service, or get into other people’s accounts. Leaving a rated match early
          counts as a loss. We may reset ratings, remove results, or suspend or delete accounts that
          break these rules.
        </p>
      </Section>
      <Section title="The service">
        <p>
          The game is provided as is. We try to keep it running but can’t promise it will always
          be available, error-free, or that ratings and results will never be lost. We may change
          or stop the game at any time.
        </p>
      </Section>
      <Section title="Liability">
        <p>
          To the extent the law allows, {OPERATOR} isn’t liable for indirect or consequential
          losses from using the game.
        </p>
      </Section>
      <Section title="Contact and law">
        <p>
          Questions: {CONTACT}. These terms are governed by the laws of {LAW}.
        </p>
      </Section>
    </>
  );
}
