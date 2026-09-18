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

// Paystack telco codes for Ghana MoMo (GET /bank?currency=GHS&type=mobile_money).
const MOMO_BANK_CODES = { mtn: 'MTN', vodafone: 'VOD', airteltigo: 'ATL' };

const API_URL = () => env.paystackApiUrl.replace(/\/+$/, '');

async function paystackCall(path, body, method = 'POST') {
  const res = await fetch(`${API_URL()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.paystackSecretKey}`,
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
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
export async function initCharge({ email, amountPesewas, reference, metadata, callbackUrl }) {
  // POST /transaction/initialize: returns { authorization_url, access_code, reference }.
  // channels limits Checkout to Mobile Money; callback_url brings the
  // player back to the tournament page after they approve on the phone.
  return paystackCall('/transaction/initialize', {
    email,
    amount: amountPesewas,
    currency: 'GHS',
    channels: ['mobile_money'],
    reference,
    callback_url: callbackUrl,
    metadata,
  });
}

/**
 * Verify a charge by reference (GET /transaction/verify/:reference).
 * Used by the sweeper as a safety net when a charge.success webhook is
 * delayed or lost. Returns { status: 'success'|'failed'|'abandoned'|..., amount, currency }.
 */
export async function verifyCharge(reference) {
  return paystackCall(`/transaction/verify/${encodeURIComponent(reference)}`, null, 'GET');
}

/**
 * Resolve the account name behind a MoMo number (Paystack "Resolve Account").
 * GET /bank/resolve?account_number=0244123456&bank_code=MTN
 * Returns { account_name, account_number } — shown to the player so they
 * confirm the number is theirs before it is locked (replaces SMS OTP).
 */
export async function resolveMomoAccount({ phone, provider }) {
  const local = `0${phone.slice(4)}`; // +233XXXXXXXXX → 0XXXXXXXXX
  const qs = new URLSearchParams({ account_number: local, bank_code: MOMO_BANK_CODES[provider] });
  const res = await fetch(`${API_URL()}/bank/resolve?${qs}`, {
    headers: { Authorization: `Bearer ${env.paystackSecretKey}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) {
    throw new Error(`Paystack /bank/resolve failed: ${json.message ?? `HTTP ${res.status}`}`);
  }
  return { account_name: json.data?.account_name ?? null, account_number: json.data?.account_number ?? local };
}

/** Create a MoMo transfer recipient (name + E.164 phone). */
export async function createTransferRecipient({ name, phone, provider }) {
  // POST /transferrecipient: Ghana MoMo recipients take a local number and
  // the telco code (MTN, VOD, ATL). Returns { recipient_code, ... }.
  const data = await paystackCall('/transferrecipient', {
    type: 'mobile_money',
    name,
    account_number: `0${phone.slice(4)}`, // +233XXXXXXXXX to 0XXXXXXXXX
    bank_code: MOMO_BANK_CODES[provider],
    currency: 'GHS',
  });
  return data.recipient_code;
}

/**
 * Initiate a MoMo transfer from the merchant balance.
 * Returns { transfer_code, ... }; status is tracked via webhooks
 * (transfer.pending / transfer.success / transfer.failed).
 */
export async function initTransfer({ recipientCode, amountPesewas, reason, reference }) {
  // POST /transfer: reference must be 16 to 50 chars of [a-z0-9_-].
  return paystackCall('/transfer', {
    source: 'balance',
    recipient: recipientCode,
    amount: amountPesewas,
    currency: 'GHS',
    reason,
    reference,
  });
}

/**
 * Verify a Paystack webhook: hex HMAC-SHA-512 of the RAW body with
 * PAYSTACK_WEBHOOK_SECRET (Paystack signs with your secret key, so set it
 * to the same value as PAYSTACK_SECRET_KEY) must equal x-paystack-signature.
 * Paystack's digest is hex (docs: `.digest('hex')`); base64 is accepted too
 * so older mocks keep working.
 * `rawBody` is a Buffer (the route receives it via express.raw so the
 * signature is checked on exactly the bytes that arrived).
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !Buffer.isBuffer(rawBody)) return false;
  const digest = crypto.createHmac('sha512', env.paystackWebhookSecret).update(rawBody).digest();
  const given = Buffer.from(String(signatureHeader).trim(), 'utf8');
  for (const encoding of ['hex', 'base64']) {
    const want = Buffer.from(digest.toString(encoding), 'utf8');
    if (given.length === want.length && crypto.timingSafeEqual(given, want)) return true;
  }
  return false;
}

export const paystack = { initCharge, verifyCharge, resolveMomoAccount, createTransferRecipient, initTransfer, verifyWebhookSignature };
