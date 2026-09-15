import { env } from '../config/env.js';

/**
 * Expo push (Module 3E) — one HTTPS call to the Expo Push API, no SDK.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * 'mock' (dev)  — prints to the console.
 * 'expo' (prod) — real sends. EXPO_ACCESS_TOKEN is optional (only needed
 *                 if push security is enabled on the Expo project).
 *
 * send() returns per-token tickets. A 'DeviceNotRegistered' ticket means
 * the token is dead and the caller should delete it.
 */
const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

export function createPushProvider() {
  if (env.pushProvider === 'mock') {
    return {
      name: 'mock',
      async send(messages) {
        for (const m of messages) console.log(`[mock-push] to=${m.to} :: ${m.title} — ${m.body}`);
        return messages.map(() => ({ status: 'ok' }));
      },
    };
  }

  if (env.pushProvider === 'expo') {
    return {
      name: 'expo',
      async send(messages) {
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (env.expoAccessToken) headers.Authorization = `Bearer ${env.expoAccessToken}`;
        const res = await fetch(EXPO_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Expo push failed: ${json.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
        return json.data ?? [];
      },
    };
  }

  throw new Error(`PUSH_PROVIDER '${env.pushProvider}' is not supported — use 'mock' or 'expo'`);
}

export const push = createPushProvider();
