import { createApp } from './app.js';
import { env } from './config/env.js';
import { startPendingTtlSweeper } from './sweeper/pendingTtl.js';
import { startBracketGenSweeper } from './sweeper/bracketGen.js';
import { startPayoutRetrySweeper } from './sweeper/payoutRetry.js';
import { startMatchFlowSweeper } from './sweeper/matchFlow.js';
import { startNotificationsSweeper } from './sweeper/notifications.js';
import { cloudinaryHealth } from './services/screenshots.js';

const app = createApp();

app.listen(env.port, '0.0.0.0', () => {
  console.log(
    `ClashGH API listening on 0.0.0.0:${env.port} ` +
      `(auth: ${env.authProvider}, mail: ${env.mailProvider}, push: ${env.pushProvider}, paystack: ${env.paystackMode}, screenshots: ${env.screenshotStorage}, env: ${env.nodeEnv})`,
  );
  startPendingTtlSweeper();
  startBracketGenSweeper();
  startPayoutRetrySweeper();
  startMatchFlowSweeper();
  startNotificationsSweeper();
  if (env.screenshotStorage === 'cloudinary') {
    cloudinaryHealth()
      .then(() => console.log(`[screenshots] cloudinary OK (cloud: ${env.cloudinaryCloudName}, retention ${env.screenshotRetentionDays}d)`))
      .catch((err) => console.error('[screenshots] CLOUDINARY MISCONFIGURED — uploads will fail:', err.message));
  }
});
