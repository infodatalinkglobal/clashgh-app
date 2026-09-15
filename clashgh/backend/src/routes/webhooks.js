import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { paystack } from '../services/paystack.js';
import { settleChargeSuccess, settleChargeFailure, updateTransferStatus } from '../services/payment.js';

/**
 * Paystack webhook endpoint (Module 1E, LIVE mode only).
 *
 * Security: the handler receives the RAW body (express.raw) and rejects
 * anything whose HMAC-SHA-512 signature (base64, key =
 * PAYSTACK_WEBHOOK_SECRET) does not match the x-paystack-signature
 * header — timing-safe compare. No query params, no client auth.
 *
 * Idempotency: handlers are idempotent (settle-by-reference,
 * status-by-transfer-code), and every successfully processed event is
 * recorded in webhook_events keyed by its unique Paystack event id, so
 * duplicate deliveries are visible in the audit trail and double-apply
 * to nothing.
 *
 * The route is mounted with `express.raw` in app.js so the signature is
 * verified on the exact bytes that arrived.
 */

const EVENT_HANDLERS = {
  'charge.success': (d) => settleChargeSuccess(d.reference, d),
  'charge.failure': (d) => settleChargeFailure(d.reference),
  'transfer.success': (d) => updateTransferStatus(d.transfer_code, 'success'),
  'transfer.failed': (d) => updateTransferStatus(d.transfer_code, 'failed'),
  'transfer.pending': async () => ({ applied: false, reason: 'transfer pending — no action until success/failed' }),
};

export async function paystackWebhookHandler(req, res) {
  try {
    if (env.paystackMode !== 'live') {
      return res.status(404).json({ success: false, data: null, message: 'Endpoint not found' });
    }

    const signature = req.headers['x-paystack-signature'];
    if (!paystack.verifyWebhookSignature(req.body, signature)) {
      console.warn('[webhook] rejected: bad signature');
      return res.status(401).json({ success: false, data: null, message: 'Invalid webhook signature' });
    }

    let event;
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).json({ success: false, data: null, message: 'Malformed JSON body' });
    }

    const eventType = event?.event;
    const eventId = event?.id;
    const data = event?.data ?? {};
    const handler = EVENT_HANDLERS[eventType];
    if (!handler) {
      return res.json({ success: true, data: { ignored: true }, message: 'Event type not handled' });
    }
    if (!eventId) {
      return res.status(400).json({ success: false, data: null, message: 'Event id missing' });
    }

    // Idempotent processing first, then the dedupe record — a duplicate
    // arriving before the first insert simply re-runs the (idempotent)
    // handler and upserts the same event row.
    const result = await handler(data);
    await pool.query(
      `INSERT INTO public.webhook_events (paystack_event_id, event_type, payload, processed_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (paystack_event_id) DO UPDATE SET processed_at = now()`,
      [eventId, eventType, JSON.stringify(data)],
    );

    console.log(`[webhook] processed ${eventType} (${eventId})`);
    return res.json({ success: true, data: { event: eventType, ...result }, message: 'Webhook processed' });
  } catch (err) {
    // 500 → Paystack retries; processing is idempotent so a retry is safe.
    console.error('[webhook] processing error:', err);
    return res.status(500).json({ success: false, data: null, message: 'Processing failed — Paystack will retry' });
  }
}
