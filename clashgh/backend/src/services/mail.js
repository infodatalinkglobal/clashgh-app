import { env } from '../config/env.js';

/**
 * Pluggable email provider (Module 3E).
 *
 * Interface every implementation must satisfy:
 *   { name: string, send({ to, subject, text, html }): Promise<{ id: string | null }> }
 *
 * 'mock'   (dev)  — prints the message to the server console. Zero cost,
 *                   zero accounts; what you see in the log is what the
 *                   player would receive.
 * 'resend' (prod) — https://resend.com REST API, one HTTPS call, no SDK.
 *                   Needs RESEND_API_KEY + MAIL_FROM (a verified domain,
 *                   e.g. "ClashGH <no-reply@clashgh.app>").
 *
 * Switching is a one-line env change (MAIL_PROVIDER). A provider error is
 * thrown to the caller — the notifications outbox retries with backoff, so
 * an outage never blocks or rolls back a money transaction.
 */
export function createMailProvider() {
  if (env.mailProvider === 'mock') {
    return {
      name: 'mock',
      async send({ to, subject, text }) {
        console.log(`[mock-mail] to=${to} :: ${subject}\n${indent(text)}`);
        return { id: null };
      },
    };
  }

  if (env.mailProvider === 'resend') {
    return {
      name: 'resend',
      async send({ to, subject, text, html }) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: env.mailFrom, to: [to], subject, text, html }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(`Resend failed: ${json.message ?? json.name ?? `HTTP ${res.status}`}`);
        }
        return { id: json.id ?? null };
      },
    };
  }

  throw new Error(`MAIL_PROVIDER '${env.mailProvider}' is not supported — use 'mock' or 'resend'`);
}

function indent(s) {
  return String(s).split('\n').map((l) => `    ${l}`).join('\n');
}

export const mail = createMailProvider();
