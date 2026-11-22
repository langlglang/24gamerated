/**
 * Shown over a play screen only when a phone is held sideways (see
 * `.turn-upright` in index.css): the cards and the Buzz button cannot all fit
 * in ~375px of height, and scrolling mid-hand costs the hand. Tablets and
 * desktops are taller than the cut-off and never see it.
 */
export function TurnUpright() {
  return (
    <div className="turn-upright" role="alert">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </svg>
      <p className="font-display text-2xl font-extrabold">Turn your phone upright</p>
      <p className="text-sm text-muted">The game is laid out for portrait.</p>
    </div>
  );
}
