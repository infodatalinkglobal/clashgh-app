/**
 * Prize pool & split calculation — integer pesewa math only (agent.md §3, §9).
 *
 * The TOTAL collected is split: 1st gets firstPercent, runner-up gets
 * runnerupPercent (both of the total, defaults 70/20), platform fee is
 * the remainder (default 10) and absorbs any rounding (<= 2 pesewas).
 */

/**
 * @param hostCommissionPercent  For HOSTED tournaments: the platform's share
 *   of the remainder (host cut). 50 = split 50/50 with the host. Pass null
 *   (default) for official tournaments — the whole remainder is platform fee.
 *   Host gets the floor, platform absorbs rounding, so `first + runnerup +
 *   host + platform === total` always holds (money invariant).
 */
export function computeSplit(totalPesewas, firstPercent, runnerupPercent, hostCommissionPercent = null) {
  const first = Math.floor((totalPesewas * firstPercent) / 100);
  const runnerup = Math.floor((totalPesewas * runnerupPercent) / 100);
  const remainder = totalPesewas - first - runnerup;
  let host = 0;
  if (hostCommissionPercent !== null && hostCommissionPercent !== undefined) {
    host = Math.floor((remainder * (100 - hostCommissionPercent)) / 100);
  }
  const platform = remainder - host;
  return {
    first,
    runnerup,
    host,
    platform,
    prize_pool: first + runnerup,
  };
}

/** Runner-up prize if the lobby fills completely — used for the min-prize floor. */
export function runnerupPrizeIfFull(entryFeePesewas, maxPlayers, runnerupPercent) {
  return Math.floor((entryFeePesewas * maxPlayers * runnerupPercent) / 100);
}

export function pesewasToGhsString(pesewas) {
  const sign = pesewas < 0 ? '-' : '';
  const abs = Math.abs(pesewas);
  return `${sign}₵${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
