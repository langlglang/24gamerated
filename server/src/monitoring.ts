import * as Sentry from '@sentry/node';
import { IS_PRODUCTION } from './config.js';

/**
 * Error monitoring. Off unless SENTRY_DSN is set, so local runs and tests
 * never send anything. Only errors are reported (no performance tracing, no
 * request bodies), and personal data is not attached by default.
 */
const dsn = (process.env.SENTRY_DSN ?? '').trim();
let enabled = false;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? (IS_PRODUCTION ? 'production' : 'development'),
    release: process.env.RENDER_GIT_COMMIT,
    tracesSampleRate: 0,
  });
  enabled = true;
  console.log('[monitoring] Sentry error reporting is on');
}

export function isMonitoringEnabled(): boolean {
  return enabled;
}

/** Report a server-side error. Safe to call when monitoring is off. */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(err);
  });
}

/** A crash report from a player's browser, already trimmed and validated. */
export function reportClientError(report: { message: string; stack?: string; url?: string; ua?: string }): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('source', 'browser');
    scope.setExtras({ url: report.url, userAgent: report.ua, stack: report.stack });
    Sentry.captureMessage(`[browser] ${report.message}`, 'error');
  });
}

/** Wait briefly for queued reports to send, e.g. before a graceful exit. */
export async function flushMonitoring(timeoutMs = 2_000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
