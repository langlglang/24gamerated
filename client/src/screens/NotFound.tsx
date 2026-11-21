interface Props {
  /** 'room' for a /room/ link whose code can't be a real room. */
  kind: 'page' | 'room';
  onHome: () => void;
}

/** A dead end that isn't one: say what happened, then offer the way home. */
export function NotFound({ kind, onHome }: Props) {
  const room = kind === 'room';
  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-6 px-5 pb-8 pt-6">
      <header className="flex flex-col items-center gap-3 pt-16 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-lg border-[3px] border-dashed border-ink bg-card">
          <span className="font-display text-5xl font-extrabold">?</span>
        </div>
        <p className="eyebrow">{room ? 'Room not found' : 'Page not found'}</p>
        <h1 className="font-display text-3xl font-extrabold">
          {room ? 'That room link doesn’t work.' : 'Nothing lives here.'}
        </h1>
        <p className="max-w-[20rem] text-muted">
          {room
            ? 'The code in it isn’t a room code. Codes are 6 letters and numbers. Ask the host to send the link again, or join from the home page.'
            : 'The link may be mistyped or out of date. Everything in the game starts from the home page.'}
        </p>
      </header>

      <div className="flex flex-col gap-3 pt-2">
        <a
          href="/"
          className="btn-primary h-14 text-lg"
          onClick={(e) => {
            // Stay in the app (no reload) for a plain click; let modified
            // clicks (new tab, etc.) behave like a normal link.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onHome();
          }}
        >
          Go to home
        </a>
      </div>
    </div>
  );
}
