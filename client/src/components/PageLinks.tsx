import type { ReactNode } from 'react';

/**
 * A real link (crawlable, opens in a new tab with a modifier key) that
 * navigates inside the app on a plain click.
 */
export function PageLink({
  href,
  onNavigate,
  className,
  children,
}: {
  href: string;
  onNavigate: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onNavigate();
        window.scrollTo(0, 0);
      }}
    >
      {children}
    </a>
  );
}

export function BackLink({ onHome }: { onHome: () => void }) {
  return (
    <PageLink href="/" onNavigate={onHome} className="btn-secondary h-12">
      Back to the game
    </PageLink>
  );
}
