/**
 * Sends uncaught browser errors to the server (/api/client-error), which logs
 * them and forwards them to Sentry when monitoring is on. Capped per page load
 * and de-duplicated, so a render loop can't flood anything. No personal data:
 * only the message, a trimmed stack, the page path and the user agent.
 */
const MAX_REPORTS = 5;
let sent = 0;
const seen = new Set<string>();

function send(message: string, stack?: string): void {
  if (sent >= MAX_REPORTS || !message) return;
  const key = `${message}|${(stack ?? '').slice(0, 200)}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent += 1;
  const body = JSON.stringify({
    message: message.slice(0, 500),
    stack: stack?.slice(0, 4000),
    url: location.pathname,
    ua: navigator.userAgent.slice(0, 300),
  });
  // keepalive lets the report finish even if the page is closing.
  void fetch('/api/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Reporting must never cause another error.
  });
}

export function installErrorReporter(): void {
  window.addEventListener('error', (event) => {
    const err = event.error as Error | undefined;
    send(err?.message ?? event.message, err?.stack);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    if (reason instanceof Error) send(reason.message, reason.stack);
    else send(String(reason));
  });
}
