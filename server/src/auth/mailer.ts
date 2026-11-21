import { IS_PRODUCTION } from '../config.js';

/**
 * Outgoing email. Sends through Resend's HTTP API when RESEND_API_KEY is set
 * (no SDK needed). Without it, development prints the message to the console
 * so the reset flow can be tested locally; production logs that email is not
 * configured and sends nothing.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.MAIL_FROM?.trim());
}

export async function sendMail(mail: Mail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();

  if (!apiKey || !from) {
    if (IS_PRODUCTION) {
      console.error('[mail] RESEND_API_KEY / MAIL_FROM not set — email not sent');
    } else {
      console.log(`[mail] (dev, not sent) to ${mail.to}: ${mail.subject}\n${mail.text}`);
    }
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/**
 * Base URL for links in emails. Taken from APP_URL, never from the request's
 * Host header: a forged Host would otherwise send a victim a reset link that
 * points at someone else's site.
 */
export function appUrl(): string | null {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  return IS_PRODUCTION ? null : (process.env.DEV_CLIENT_ORIGIN ?? 'http://localhost:5173');
}
