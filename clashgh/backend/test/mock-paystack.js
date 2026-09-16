/**
 * Local Paystack test double for integration-testing the LIVE code path
 * (Module 1E) with zero real money and zero real keys.
 *
 * Implements:
 *   POST /transaction/initialize     : MoMo charge init (echoes our reference)
 *   POST /transferrecipient          : MoMo recipient creation
 *   GET  /transaction/verify/:ref    : charge verification
 *   POST /transfer                   : MoMo transfer (resolves via webhooks)
 *   GET  /momo-approve?reference=…   — stands in for the phone approval screen
 *   GET  /momo-decline?reference=…   — stands in for a declined approval
 *
 * Webhooks are delivered to the API with REAL HMAC-SHA-512 signatures
 * (same scheme as production Paystack), so signature verification,
 * dedupe, and idempotent settlement are all exercised for real.
 *
 * Transfer failure toggle: recipients whose NAME matches /fail/i produce
 * a transfer.failed webhook instead of transfer.success (used to test
 * the payout retry backoff).
 *
 * Run:  node test/mock-paystack.js
 * Env:  MOCK_PORT (4000), MOCK_PAYSTACK_SECRET (mock-paystack-secret),
 *       MOCK_API_WEBHOOK (http://127.0.0.1:3000/api/paystack/webhook)
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 4000);
const SECRET = process.env.MOCK_PAYSTACK_SECRET || 'mock-paystack-secret';
const API_WEBHOOK = process.env.MOCK_API_WEBHOOK || 'http://127.0.0.1:3000/api/paystack/webhook';

let eventId = 0;
const recipients = new Map();
const approved = new Set();

function sign(rawBody) {
  return crypto.createHmac('sha512', SECRET).update(rawBody).digest('base64');
}

function sendWebhook(eventType, data) {
  const body = JSON.stringify({ event: eventType, id: `evt_mock_${++eventId}`, data });
  fetch(API_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sign(body) },
    body,
  })
    .then((r) => console.log(`[mock-paystack] webhook ${eventType} -> HTTP ${r.status}`))
    .catch((e) => console.error(`[mock-paystack] webhook ${eventType} delivery failed:`, e.message));
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const json = raw ? JSON.parse(raw) : {};
    const respond = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: status === 200, data, message: status === 200 ? 'ok' : 'error' }));
    };

    if (req.url === '/transaction/initialize') {
      const reference = json.reference ?? `CHRG_MOCK_${Date.now()}`;
      console.log(`[mock-paystack] charge init ${reference} (${json.amount} ${json.currency} via ${(json.channels || []).join(',')})`);
      respond({
        authorization_url: `http://127.0.0.1:${PORT}/momo-approve?reference=${reference}`,
        access_code: `ACC_${reference}`,
        reference,
      });
      return;
    }

    if (req.url === '/transferrecipient') {
      const recipient_code = `RCP_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
      recipients.set(recipient_code, json.name);
      console.log(`[mock-paystack] recipient created ${recipient_code} (${json.name}, ${json.bank_code} ${json.account_number})`);
      respond({ recipient_code, type: json.type, name: json.name, currency: json.currency });
      return;
    }

    if (req.url === '/transfer') {
      const transferCode = `TRF_MOCK_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
      if (!/^[a-z0-9_-]{16,50}$/.test(String(json.reference))) { respond({ message: 'invalid reference' }, 400); return; }
      const recipientName = recipients.get(json.recipient) ?? '';
      const willFail = /fail/i.test(String(recipientName));
      console.log(
        `[mock-paystack] transfer ${transferCode} (${json.amount} ${json.currency})${willFail ? ' [will FAIL]' : ''}`,
      );
      setTimeout(() => sendWebhook('transfer.pending', { transfer_code: transferCode }), 40);
      setTimeout(
        () => sendWebhook(willFail ? 'transfer.failed' : 'transfer.success', { transfer_code: transferCode }),
        250,
      );
      respond({ transfer_code: transferCode, status: 'pending' });
      return;
    }

    if (req.url.startsWith('/transaction/verify/')) {
      const reference = decodeURIComponent(req.url.split('/transaction/verify/')[1]);
      const status = approved.has(reference) ? 'success' : 'abandoned';
      respond({ reference, status, amount: 0, currency: 'GHS', channel: 'mobile_money' });
      return;
    }

    if (req.url.startsWith('/momo-approve')) {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      const reference = url.searchParams.get('reference');
      approved.add(reference);
      console.log(`[mock-paystack] user approved MoMo charge ${reference} on phone`);
      setTimeout(() => sendWebhook('charge.success', { reference, amount: 0 }), 40);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Approved (mock MoMo)');
      return;
    }

    if (req.url.startsWith('/momo-decline')) {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      const reference = url.searchParams.get('reference');
      console.log(`[mock-paystack] user DECLINED MoMo charge ${reference} on phone`);
      setTimeout(() => sendWebhook('charge.failure', { reference, reason: 'customer_declined' }), 40);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Declined (mock MoMo)');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock-paystack] listening on 0.0.0.0:${PORT} (webhook target: ${API_WEBHOOK})`);
});
