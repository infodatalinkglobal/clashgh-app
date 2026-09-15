import path from 'node:path';
import express from 'express';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { adminDashboardRouter } from './routes/adminDashboard.js';
import { notificationsRouter } from './routes/notifications.js';
import { tournamentRouter } from './routes/tournaments.js';
import { matchRouter } from './routes/matches.js';
import { devAuthRouter } from './routes/devAuth.js';
import { devPayRouter } from './routes/devPay.js';
import { hostsRouter } from './routes/hosts.js';
import { paystackWebhookHandler } from './routes/webhooks.js';
import { uploadsRouter, mountLocalScreenshotStatic } from './routes/uploads.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Render / preview proxies — correct req.protocol for upload URLs

  // Paystack webhook FIRST, with a raw body: the global express.json()
  // below would otherwise consume the body before the HMAC-SHA-512
  // signature can be verified on the exact bytes that arrived.
  // Mounted only in live mode.
  if (env.paystackMode === 'live') {
    app.post('/api/paystack/webhook', express.raw({ type: () => true }), paystackWebhookHandler);
  }

  const jsonSmall = express.json();
  app.use((req, res, next) => (req.path === '/api/uploads/screenshot' ? next() : jsonSmall(req, res, next)));

  // CORS — needed by browser clients (Expo web preview in dev, the 3C
  // admin panel later). Native apps are unaffected. Origins are locked
  // down via CORS_ORIGINS in production; open outside production.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = env.nodeEnv !== 'production' || (origin && env.corsOrigins.includes(origin));
    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-ClashGH-Token');
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
  app.use('/api', notificationsRouter);
  app.use('/api', adminRouter);
  app.use('/api', adminDashboardRouter);
  app.use('/api', hostsRouter);
  app.use('/api/tournaments', tournamentRouter);
  app.use('/api/matches', matchRouter);
  app.use('/api', uploadsRouter);
  mountLocalScreenshotStatic(app);

  // Dev stubs: only outside production, and only in their dev modes.
  if (env.authProvider === 'stub' && env.nodeEnv !== 'production') {
    app.use('/api', devAuthRouter());
  }
  if (env.paystackMode === 'stub' && env.nodeEnv !== 'production') {
    app.use('/api', devPayRouter());
  }

  // Web app: when WEB_DIST points at an `expo export --platform web` output
  // directory, serve it from the same origin as the API. Same-origin means
  // no CORS, cookies-free bearer auth works, and the Paystack callback and
  // Google OAuth redirect land on one host. Hashed bundles cache forever;
  // index.html never does. Anything that isn't /api or a real file falls
  // back to index.html (client-side routing).
  if (env.webDist) {
    const webDist = path.resolve(env.webDist);
    app.use(express.static(webDist, {
      index: 'index.html',
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}_expo${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    }));
    app.get(/^(?!\/api(\/|$)).*/, (req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
