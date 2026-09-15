import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errorHandler.js';
import { computeSplit } from '../utils/prize.js';
import { generateBracket } from './bracket.js';
import { paystack } from './paystack.js';

/**
 * Money service — entry fees (1C), refunds & payouts via MoMo transfers (1E).
 *
 * Modes:
 *  - PAYSTACK_MODE=stub (dev): charges settle through
 *    /api/dev/paystack/simulate-charge; transfers "complete" immediately.
 *  - PAYSTACK_MODE=live: real Paystack Charge + Transfer APIs; state
 *    changes arrive via the signed webhook (/api/paystack/webhook),
 *    which is the ONLY settlement path.
 *
 * Money invariants:
 *  - one entry_fee transaction per registration (settle is idempotent)
 *  - settlement only for PENDING registrations inside the payment window
 *  - paid_count reaches max_players → tournament 'full' + bracket (1D)
 *  - at most ONE payout per (match, user) — enforced by the partial
 *    unique index (final match legitimately has two payout rows)
 */

// ---------------------------------------------------------------------------
// Entry-fee charges (1C)
// ---------------------------------------------------------------------------

/**
 * Begin an entry-fee charge. Returns { reference, authorization_url, ... }.
 * The reference is stored on the registration; settlement later looks it
 * up by that exact string (webhook in live mode, dev endpoint in stub).
 *
 * IMPORTANT: call this OUTSIDE any DB transaction (it is an HTTP call in
 * live mode); the join flow is structured around that.
 */
export async function initiateEntryFeeCharge({ user, tournament }) {
  if (env.paystackMode === 'live') {
    const reference = `CHRG_${crypto.randomUUID()}`;
    const data = await paystack.initCharge({
      email: user.email,
      amountPesewas: tournament.entry_fee_pesewas,
      reference,
      metadata: { user_id: user.id, tournament_id: tournament.id },
    });
    return {
      reference: data.reference ?? reference,
      channel: 'mobile_money',
      provider: user.momo_provider,
      amount_pesewas: tournament.entry_fee_pesewas,
      authorization_url: data.authorization?.authorization_url ?? null,
      note: 'Approve the charge on your phone to lock your spot',
    };
  }
  return {
    reference: `CHRG_DEV_${crypto.randomUUID()}`,
    channel: 'mobile_money',
    provider: user.momo_provider,
    amount_pesewas: tournament.entry_fee_pesewas,
    authorization_url: null,
    note: 'Dev mode: settle with POST /api/dev/paystack/simulate-charge {reference, success:true}',
  };
}

/**
 * Settle a successful charge. Idempotent: an already-settled or expired
 * reference settles exactly once. (1E: called by the verified
 * charge.success webhook; 1C: by the dev simulate endpoint.)
 */
export async function settleChargeSuccess(reference) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE public.registrations r
       SET payment_status = 'paid'
       FROM public.tournaments t
       WHERE r.payment_reference = $1
         AND r.payment_status = 'pending'
         AND r.created_at > now() - make_interval(mins => $2)
         AND t.id = r.tournament_id
       RETURNING r.id, r.tournament_id, r.user_id,
                 t.entry_fee_pesewas AS fee, t.title AS title, t.max_players`,
      [reference, env.registrationPendingTtlMinutes],
    );

    if (rows.length === 0) {
      await client.query('COMMIT');
      return { settled: false, reason: 'reference unknown, already settled, or payment window expired' };
    }

    const reg = rows[0];
    await client.query(
      `INSERT INTO public.transactions
         (user_id, tournament_id, type, amount_pesewas, status, paystack_reference, direction, description)
       VALUES ($1, $2, 'entry_fee', $3, 'success', $4, 'in', $5)`,
      [reg.user_id, reg.tournament_id, reg.fee, reference, `Entry fee — ${reg.title}`],
    );

    const { rows: [fullCheck] } = await client.query(
      `UPDATE public.tournaments t
       SET status = 'full'
       WHERE t.id = $1
         AND t.status = 'open'
         AND (SELECT count(*) FROM public.registrations r
               WHERE r.tournament_id = t.id AND r.payment_status = 'paid') = t.max_players
       RETURNING t.id`,
      [reg.tournament_id],
    );

    await client.query('COMMIT');

    // The lobby just filled — generate the bracket NOW (1D). If this
    // throws, the 60s safety sweep regenerates it; money is already
    // settled, so log and continue.
    let bracket = null;
    if (fullCheck !== undefined) {
      try {
        bracket = await generateBracket(reg.tournament_id);
      } catch (err) {
        console.error('[payment] bracket generation failed (sweep will retry):', err.message);
      }
    }

    return { settled: true, registrationId: reg.id, tournamentFull: fullCheck !== undefined, bracket };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Settle a failed charge: no money moved, nothing to ledger. The
 * registration stays pending; the player may rejoin after the payment
 * window (10 min) expires and releases the slot.
 */
export async function settleChargeFailure(reference) {
  const { rows } = await pool.query(
    `SELECT id FROM public.registrations WHERE payment_reference = $1 AND payment_status = 'pending'`,
    [reference],
  );
  return {
    settled: false,
    reason: rows.length
      ? 'charge failed — registration stays pending until the payment window expires'
      : 'reference unknown',
  };
}

// ---------------------------------------------------------------------------
// MoMo transfers: refunds + payouts (1E)
// ---------------------------------------------------------------------------

/** Payout retry backoff — agent.md §9 step 6: 15min / 1h / 6h, max 3. */
export const RETRY_BACKOFF_MINUTES = [15, 60, 360];
export const MAX_PAYOUT_RETRIES = 3;

function backoffDueDate(attempts) {
  const idx = Math.min(Math.max(attempts, 0), RETRY_BACKOFF_MINUTES.length - 1);
  return new Date(Date.now() + RETRY_BACKOFF_MINUTES[idx] * 60_000);
}

/** Create recipient + initiate the transfer for a pending tx row. */
export async function initiateTransferForTx(tx) {
  const { rows: [user] } = await pool.query(
    'SELECT username, email, phone, momo_provider FROM public.users WHERE id = $1',
    [tx.user_id],
  );
  if (!user || !user.phone) {
    throw new Error(`Cannot transfer: user ${tx.user_id} has no verified phone`);
  }
  const name = user.username ?? user.email;
  const recipient = await paystack.createTransferRecipient({
    name,
    phone: user.phone,
    provider: user.momo_provider,
  });
  const data = await paystack.initTransfer({
    recipient: recipient.recipient ?? recipient,
    amountPesewas: tx.amount_pesewas,
    reason: tx.type === 'refund' ? 'Entry fee refund' : 'Tournament prize',
    metadata: { clashgh_tx: tx.id, tx_type: tx.type },
  });
  const transferCode = data.transfer_code;
  await pool.query('UPDATE public.transactions SET paystack_transfer_code = $2 WHERE id = $1', [
    tx.id,
    transferCode,
  ]);
  return { tx: tx.id, transfer_code: transferCode };
}

/** Alias for the cancel flow — refund transfers use the same initiation. */
export const initiateRefundTransfer = initiateTransferForTx;

/**
 * Webhook-driven transfer status update.
 * 'success' → done. 'failed' → payout rows schedule a retry (backoff,
 * max 3, then FINAL FAILURE + admin alert); refund rows stay 'failed'
 * for admin action (3C).
 */
export async function updateTransferStatus(transferCode, newStatus) {
  const { rows } = await pool.query(
    `SELECT id, type, attempts FROM public.transactions
     WHERE paystack_transfer_code = $1 AND status = 'pending'`,
    [transferCode],
  );
  if (rows.length === 0) {
    return { applied: false, reason: 'no pending transaction for this transfer' };
  }
  const tx = rows[0];

  if (newStatus === 'success') {
    await pool.query('UPDATE public.transactions SET status = $2 WHERE id = $1', [tx.id, 'success']);
    return { applied: true, tx: tx.id };
  }

  // failed
  let finalFailure = false;
  let nextRetryAt = null;
  if (tx.type === 'payout') {
    if (tx.attempts >= MAX_PAYOUT_RETRIES) {
      finalFailure = true;
    } else {
      nextRetryAt = backoffDueDate(tx.attempts);
    }
  }
  await pool.query(
    `UPDATE public.transactions SET status = $2, next_retry_at = $3 WHERE id = $1`,
    [tx.id, 'failed', nextRetryAt],
  );
  if (finalFailure) {
    console.error(
      `[payment] PAYOUT ${tx.id} FINAL FAILURE after ${tx.attempts} retries — admin attention required (alert lands in 3E)`,
    );
  }
  return { applied: true, tx: tx.id, final_failure: finalFailure, next_retry_at: nextRetryAt };
}

/**
 * Execute a tournament's payouts: champion + runner-up prizes via MoMo
 * transfer, platform fee recorded, tournament → 'completed'.
 *
 * Called by the 1F sweeper when the final match completes, and by the
 * admin endpoint (3C one-click re-payout with force=true, which retries
 * FAILED payout rows). Idempotent: existing payout rows block a second
 * initiation; the partial unique index is the DB-level backstop.
 */
export async function executePayout(tournamentId, { force = false } = {}) {
  const isLive = env.paystackMode === 'live';
  const client = await pool.connect();
  const toTransfer = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tournament:${tournamentId}`]);

    const { rows: [t] } = await client.query(
      'SELECT * FROM public.tournaments WHERE id = $1 FOR UPDATE',
      [tournamentId],
    );
    if (!t) {
      await client.query('COMMIT');
      throw new ApiError(404, 'Tournament not found');
    }
    if (!['full', 'in_progress', 'completed'].includes(t.status)) {
      await client.query('COMMIT');
      throw new ApiError(409, `Tournament is '${t.status}' — payouts run on a finished bracket`);
    }

    const totalRounds = Math.round(Math.log2(t.max_players));
    const { rows: [finalMatch] } = await client.query(
      'SELECT * FROM public.matches WHERE tournament_id = $1 AND match_round = $2 AND match_number = 1 FOR UPDATE',
      [tournamentId, totalRounds],
    );
    if (!finalMatch || finalMatch.status !== 'completed' || !finalMatch.winner_id) {
      await client.query('COMMIT');
      throw new ApiError(409, 'The final match is not completed yet — no payouts to run');
    }
    const championId = finalMatch.winner_id;
    const runnerUpId = championId === finalMatch.player1_id ? finalMatch.player2_id : finalMatch.player1_id;
    if (!runnerUpId) {
      await client.query('COMMIT');
      throw new ApiError(409, 'Final match has no second player — nothing to pay');
    }

    const { rows: existing } = await client.query(
      `SELECT id, user_id, amount_pesewas, status, attempts, paystack_transfer_code
       FROM public.transactions WHERE match_id = $1 AND type = 'payout' ORDER BY id`,
      [finalMatch.id],
    );

    if (existing.length > 0 && !force) {
      await client.query('COMMIT');
      return { payout: 'already_initiated', rows: existing };
    }

    const total = t.entry_fee_pesewas * t.max_players;
    const split = computeSplit(total, t.first_place_percent, t.runnerup_percent);
    let newlyCreated = false;

    if (existing.length === 0) {
      newlyCreated = true;
      for (const [userId, amount, label] of [
        [championId, split.first, 'Champion prize'],
        [runnerUpId, split.runnerup, 'Runner-up prize'],
      ]) {
        const { rows: [tx] } = await client.query(
          `INSERT INTO public.transactions
             (user_id, tournament_id, match_id, type, amount_pesewas, status, direction, description)
           VALUES ($1, $2, $3, 'payout', $4, $5, 'out', $6)
           RETURNING id, user_id, amount_pesewas`,
          [userId, t.id, finalMatch.id, amount, isLive ? 'pending' : 'success', `${label} — ${t.title}`],
        );
        if (isLive) toTransfer.push({ ...tx, isRetry: false });
      }
      await client.query(
        `INSERT INTO public.transactions
           (user_id, tournament_id, match_id, type, amount_pesewas, status, direction, description)
         VALUES ($1, $2, $3, 'platform_fee', $4, 'success', 'out', $5)`,
        [t.created_by, t.id, finalMatch.id, split.platform, `Platform fee — ${t.title}`],
      );
      await client.query(`UPDATE public.tournaments SET status = 'completed' WHERE id = $1`, [t.id]);
    } else if (force) {
      // 3C one-click re-payout: retry only the FAILED rows.
      for (const ex of existing) {
        if (ex.status !== 'failed') continue;
        if (isLive) {
          toTransfer.push({ id: ex.id, user_id: ex.user_id, amount_pesewas: ex.amount_pesewas, isRetry: true });
        } else {
          await client.query(
            `UPDATE public.transactions SET status = 'success', attempts = attempts + 1, next_retry_at = NULL WHERE id = $1`,
            [ex.id],
          );
        }
      }
    }

    await client.query('COMMIT');

    if (!isLive) {
      return { payout: 'initiated', mode: 'stub', tournament_completed: newlyCreated, rows: existing };
    }

    const transfers = [];
    for (const tx of toTransfer) {
      try {
        const r = await initiateTransferForTx(tx);
        if (tx.isRetry) {
          // Back to in-flight so the transfer webhook can find the row,
          // and consume one of the 3 allowed attempts.
          await pool.query(
            `UPDATE public.transactions SET status = 'pending', attempts = attempts + 1 WHERE id = $1`,
            [tx.id],
          );
        }
        transfers.push({ ...r, state: 'initiated' });
      } catch (err) {
        console.error(`[payment] payout transfer for tx ${tx.id} failed to initiate:`, err.message);
        transfers.push({ tx: tx.id, state: 'initiation_failed', error: err.message });
      }
    }
    return { payout: 'initiated', mode: 'live', tournament_completed: newlyCreated, transfers };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
