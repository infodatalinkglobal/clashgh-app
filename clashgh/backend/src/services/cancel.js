import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errorHandler.js';
import { UUID_RE } from '../utils/validate.js';
import { initiateRefundTransfer } from './payment.js';

/**
 * Tournament cancellation + full refund (Module 1C, extracted for 1F).
 *
 * Gate: cancellable while it has not started — open or full. With
 * `allowInProgress` (the 1F dispute "refund" resolution) an in-progress
 * tournament can also be cancelled: a dispute that the admin cannot
 * resolve by award or replay ends the cup and refunds every player.
 *
 * Live mode: refund ledger rows are created 'pending' and the real MoMo
 * transfers are initiated AFTER commit (HTTP never inside a DB
 * transaction); transfer.success webhooks flip each row to 'success'.
 */
export async function cancelTournament(tournamentId, adminId, { allowInProgress = false } = {}) {
  if (!UUID_RE.test(tournamentId)) throw new ApiError(400, 'Invalid tournament id');
  const isLive = env.paystackMode === 'live';
  const client = await pool.connect();
  const refundTxRows = [];
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

    const allowed = allowInProgress ? ['open', 'full', 'in_progress'] : ['open', 'full'];
    if (!allowed.includes(t.status) || (!allowInProgress && new Date() >= t.starts_at)) {
      await client.query('COMMIT');
      throw new ApiError(
        409,
        t.status === 'in_progress'
          ? 'Only an explicit dispute refund can cancel a started tournament'
          : 'Only tournaments that have not started can be cancelled — after start, handle problems per-match via disputes',
      );
    }

    const { rows: paid } = await client.query(
      `SELECT id, user_id, payment_reference FROM public.registrations
       WHERE tournament_id = $1 AND payment_status = 'paid' FOR UPDATE`,
      [tournamentId],
    );

    for (const r of paid) {
      await client.query(`UPDATE public.registrations SET payment_status = 'refunded' WHERE id = $1`, [r.id]);
      const { rows: [txRow] } = await client.query(
        `INSERT INTO public.transactions
           (user_id, tournament_id, type, amount_pesewas, status, paystack_reference, direction, description)
         VALUES ($1, $2, 'refund', $3, $4, $5, 'out', $6)
         RETURNING id, user_id, amount_pesewas`,
        [r.user_id, tournamentId, t.entry_fee_pesewas, isLive ? 'pending' : 'success', r.payment_reference, `Tournament cancelled — entry fee refunded (${t.title})`],
      );
      refundTxRows.push(txRow);
    }

    await client.query(`UPDATE public.tournaments SET status = 'cancelled' WHERE id = $1`, [tournamentId]);
    await client.query(
      `INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details)
       VALUES ($1, 'cancel_tournament', 'tournament', $2, $3)`,
      [
        adminId,
        tournamentId,
        JSON.stringify({
          refunded_count: paid.length,
          amount_refunded_pesewas: paid.length * t.entry_fee_pesewas,
          entry_fee_pesewas: t.entry_fee_pesewas,
        }),
      ],
    );

    await client.query('COMMIT');

    if (isLive) {
      for (const txRow of refundTxRows) {
        try {
          await initiateRefundTransfer(txRow);
        } catch (err) {
          // Row stays 'pending' → admin action in 3C (refunds are not
          // auto-retried by the sweeper).
          console.error(`[cancel] refund transfer for tx ${txRow.id} failed:`, err.message);
        }
      }
    }

    return {
      cancelled: true,
      tournament_id: tournamentId,
      refunded_count: paid.length,
      amount_refunded_pesewas: paid.length * t.entry_fee_pesewas,
      refund_state: isLive ? 'transfers initiated (pending until MoMo confirms)' : 'refunded',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
