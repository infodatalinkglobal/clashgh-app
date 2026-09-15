import { env } from '../config/env.js';

/**
 * Pluggable SMS provider.
 *
 * Interface every implementation must satisfy:
 *   { name: string, send({ to, body }): Promise<{ delivered: boolean }> }
 *
 * 'mock' (dev): logs the message to the server console so OTPs are
 * visible during development with zero cost and zero accounts.
 *
 * Production providers (termii / africastalking / twilio — final choice
 * is an open item in agent.md) will be added here behind the same
 * interface; switching is a one-line env change (SMS_PROVIDER).
 */
export function createSmsProvider() {
  if (env.smsProvider === 'mock') {
    return {
      name: 'mock',
      async send({ to, body }) {
        console.log(`[mock-sms] to=${to} :: ${body}`);
        return { delivered: true };
      },
    };
  }

  throw new Error(
    `SMS_PROVIDER '${env.smsProvider}' is not implemented yet. 'mock' is available for dev; ` +
      'add the chosen Ghana provider (termii / africastalking / twilio) to src/services/sms.js before launch.',
  );
}

export const sms = createSmsProvider();
