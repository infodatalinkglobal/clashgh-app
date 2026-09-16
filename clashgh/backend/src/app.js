import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
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
import { perIp } from './middleware/rateLimit.js';
import { hostsRouter } from './routes/hosts.js';
import { paystackWebhookHandler } from './routes/webhooks.js';
import { uploadsRouter, mountLocalScreenshotStatic } from './routes/uploads.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { siteRouter, notFoundPage } from './site/pages.js';
import { fileURLToPath } from 'node:url';

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

  // Global API ceiling per IP (generous; per-route limits below are the real guards).
  app.use('/api', perIp({ windowMs: 60 * 1000, max: env.rateLimitApiPerMinute, name: 'api' }));

  const jsonSmall = express.json({ limit: '64kb' });
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

  // Canonical host: redirect www.<domain> to the apex in production.
  app.use((req, res, next) => {
    if (env.nodeEnv === 'production' && req.hostname && req.hostname.startsWith('www.')) {
      return res.redirect(301, `${env.siteOrigin}${req.originalUrl}`);
    }
    if (req.method === 'GET' && req.path.length > 1 && req.path.endsWith('/') && !req.path.startsWith('/api')) {
      return res.redirect(301, req.path.slice(0, -1) + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
    }
    next();
  });

  // Security / hygiene headers for everything served here.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=()');
    next();
  });

  // Brand assets (favicon, icons, social image) for the site and the app.
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  app.use(express.static(publicDir, { maxAge: '7d', index: false, redirect: false }));

  // Public website: server-rendered HTML at the root (home, tournaments,
  // how it works, legal pages, sitemap, robots, llms.txt). Crawlers and
  // link previews get real content; players use the app at /app.
  app.use((req, res, next) => {
    // Gzip server-rendered HTML/XML/text (small pages; no dependency needed).
    const enc = String(req.headers['accept-encoding'] || '');
    if (!enc.includes('gzip')) return next();
    const send = res.send.bind(res);
    res.send = (body) => {
      const type = String(res.getHeader('Content-Type') || '');
      if (typeof body === 'string' && /^(text\/|application\/(xml|rss\+xml|json))/.test(type) && body.length > 1024 && !res.getHeader('Content-Encoding')) {
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        return send(zlib.gzipSync(Buffer.from(body)));
      }
      return send(body);
    };
    next();
  });
  app.use(siteRouter);

  // Player app: an `expo export --platform web` build served under /app.
  // Hashed bundles cache forever; the HTML shell never does. Any /app/*
  // path falls back to the shell (client-side routing).
  if (env.webDist) {
    const webDist = path.resolve(env.webDist);
    const shell = (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex');
      res.sendFile(path.join(webDist, 'index.html'));
    };
    // Serve precompressed .br/.gz siblings when the browser accepts them.
    app.use('/app', (req, res, next) => {
      if (req.method !== 'GET' || !/\.(js|json|css|svg|txt)$/.test(req.path)) return next();
      const enc = String(req.headers['accept-encoding'] || '');
      const file = path.join(webDist, req.path);
      const pick = enc.includes('br') && fs.existsSync(`${file}.br`) ? ['br', '.br'] : enc.includes('gzip') && fs.existsSync(`${file}.gz`) ? ['gzip', '.gz'] : null;
      if (!pick) return next();
      res.setHeader('Content-Encoding', pick[0]);
      res.setHeader('Vary', 'Accept-Encoding');
      res.type(path.extname(req.path));
      res.setHeader('Cache-Control', req.path.startsWith('/_expo/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.sendFile(file + pick[1]);
    });
    app.use('/app', express.static(webDist, {
      index: false,
      redirect: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}_expo${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    }));
    app.get(/^\/app(\/.*)?$/, (req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      shell(req, res);
    });
    // Legacy deep links from before the split (e.g. /auth/callback, /tournament/:id).
    app.get(['/auth/callback', '/tournament/:id', '/match/:id'], (req, res) => res.redirect(302, `/app${req.originalUrl}`));
  }

  // HTML 404 for browsers on the public site; JSON for the API and other clients.
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && req.accepts(['html', 'json']) === 'html') {
      return res.status(404).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).send(notFoundPage());
    }
    next();
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
