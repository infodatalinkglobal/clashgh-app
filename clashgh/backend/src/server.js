import { createApp } from './app.js';
import { env } from './config/env.js';
import { startPendingTtlSweeper } from './sweeper/pendingTtl.js';
import { startBracketGenSweeper } from './sweeper/bracketGen.js';
import { startPayoutRetrySweeper } from './sweeper/payoutRetry.js';
import { startMatchFlowSweeper } from './sweeper/matchFlow.js';

const app = createApp();

app.listen(env.port, '0.0.0.0', () => {
  console.log(
    `ClashGH API listening on 0.0.0.0:${env.port} ` +
      `(auth: ${env.authProvider}, sms: ${env.smsProvider}, paystack: ${env.paystackMode}, env: ${env.nodeEnv})`,
  );
  startPendingTtlSweeper();
  startBracketGenSweeper();
  startPayoutRetrySweeper();
  startMatchFlowSweeper();
});
