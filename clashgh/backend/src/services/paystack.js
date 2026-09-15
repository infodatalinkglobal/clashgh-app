import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Paystack API client (Module 1E).
 *
 * Two concerns:
 *  1. REST calls (charge init, transfer recipients, transfer init) —
 *     server-side, Bearer secret key. Amounts are MINOR units: GHS
 *     minor unit == our stored pesewas, so values pass through as-is.
 *  2. Webhook signature verification — HMAC SHA-512 of the RAW request
 *     body, base64-encoded, compared timing-safely against the
 *     `x-paystack-signature` header (agent.md §8).
 *
 * `PAYSTACK_API_URL` defaults to https://api.paystack.co and exists so
 * the live code path can be integration-tested against the local mock
 * (backend/test/mock-paystack.js) with zero code changes.
 */

const API_URL = () => env.paystackApiUrl.replace(/\/+$/, '');

async function paystackCall(path, body) {
  const res = await fetch(`${API_URL()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.paystackSecretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) {
    throw new Error(`Paystack ${path} failed: ${json.message ?? `HTTP ${res.status}`}`);
  }
  return json.data;
}

/**
 * Initialize a MoMo entry-fee charge. Our own reference is passed and
 * echoed back by Paystack — it is the key the settle flow (webhook or
 * dev simulate) looks the registration up by.
 */
export async function initCharge({ email, amountPesewas, reference, metadata }) {
  return paystackCall('/v2/transaction/initialize', {
    email,
    amount: amountPesewas,
    currency: 'GHS',
    channel: 'mobile_money',
    reference,
    metadata,
  });
}

/** Create a MoMo transfer recipient (name + E.164 phone). */
export async function createTransferRecipient({ name, phone, provider }) {
  return paystackCall('/transfer/recipients', {
    name,
    type: 'mobile_money',
    phone,
    channel: 'mobile_money',
    provider,
  });
}

/**
 * Initiate a MoMo transfer from the merchant balance.
 * Returns { transfer_code, ... }; status is tracked via webhooks
 * (transfer.pending / transfer.success / transfer.failed).
 */
export async function initTransfer({ recipient, amountPesewas, reason, metadata }) {
  return paystackCall('/transfer/initialize', {
    source: 'balance',
    recipient,
    amount: amountPesewas,
    currency: 'GHS',
    reason,
    metadata,
  });
}

/**
 * Verify a Paystack webhook: base64 HMAC-SHA-512 of the RAW body with
 * PAYSTACK_WEBHOOK_SECRET must equal the x-paystack-signature header.
 * `rawBody` is a Buffer (the route receives it via express.raw so the
 * signature is checked on exactly the bytes that arrived).
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !Buffer.isBuffer(rawBody)) return false;
  const expected = crypto
    .createHmac('sha512', env.paystackWebhookSecret)
    .update(rawBody)
    .digest('base64');
  const given = Buffer.from(signatureHeader, 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}

export const paystack = { initCharge, createTransferRecipient, initTransfer, verifyWebhookSignature };
