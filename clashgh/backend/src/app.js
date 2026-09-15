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

  // CORS — needed by browser clients (Expo web preview in dev, the 3C
  // admin panel later). Native apps are unaffected. Origins are locked
  // down via CORS_ORIGINS in production; open outside production.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = env.nodeEnv !== 'production' || (origin && env.corsOrigins.includes(origin));
    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

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
