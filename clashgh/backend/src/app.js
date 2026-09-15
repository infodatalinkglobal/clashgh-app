import express from 'express';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { tournamentRouter } from './routes/tournaments.js';
import { matchRouter } from './routes/matches.js';
import { devAuthRouter } from './routes/devAuth.js';
import { devPayRouter } from './routes/devPay.js';
import { paystackWebhookHandler } from './routes/webhooks.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  // Paystack webhook FIRST, with a raw body: the global express.json()
  // below would otherwise consume the body before the HMAC-SHA-512
  // signature can be verified on the exact bytes that arrived.
  // Mounted only in live mode.
  if (env.paystackMode === 'live') {
    app.post('/api/paystack/webhook', express.raw({ type: () => true }), paystackWebhookHandler);
  }

  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      data: { status: 'ok', auth_provider: env.authProvider, time: new Date().toISOString() },
      message: 'ClashGH API is running',
    });
  });

  app.use('/api', authRouter);
  app.use('/api', adminRouter);
  app.use('/api/tournaments', tournamentRouter);
  app.use('/api/matches', matchRouter);

  // Dev stubs: only outside production, and only in their dev modes.
  if (env.authProvider === 'stub' && env.nodeEnv !== 'production') {
    app.use('/api', devAuthRouter());
  }
  if (env.paystackMode === 'stub' && env.nodeEnv !== 'production') {
    app.use('/api', devPayRouter());
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
