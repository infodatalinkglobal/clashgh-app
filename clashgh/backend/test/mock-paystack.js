/**
 * Local Paystack test double for integration-testing the LIVE code path
 * (Module 1E) with zero real money and zero real keys.
 *
 * Implements:
 *   POST /v2/transaction/initialize  — MoMo charge init (echoes our reference)
 *   POST /transfer/recipients        — MoMo recipient creation
 *   POST /transfer/initialize        — MoMo transfer (resolves via webhooks)
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

    if (req.url === '/v2/transaction/initialize') {
      const reference = json.reference ?? `CHRG_MOCK_${Date.now()}`;
      console.log(`[mock-paystack] charge init ${reference} (${json.amount} ${json.currency} via ${json.channel})`);
      respond({
        reference,
        status: 'pending',
        authorization: {
          authorization_url: `http://127.0.0.1:${PORT}/momo-approve?reference=${reference}`,
          approval: `MOMO_${reference}`,
        },
        channel: json.channel,
        amount: json.amount,
      });
      return;
    }

    if (req.url === '/transfer/recipients') {
      const recipient = {
        recipient_code: `REC_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
        name: json.name,
        phone: json.phone,
        channel: json.channel,
      };
      console.log(`[mock-paystack] recipient created ${recipient.recipient_code} (${recipient.name})`);
      respond({ recipient });
      return;
    }

    if (req.url === '/transfer/initialize') {
      const transferCode = `TRF_MOCK_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
      const recipientName = json.recipient?.name ?? json.name ?? '';
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

    if (req.url.startsWith('/momo-approve')) {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      const reference = url.searchParams.get('reference');
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
