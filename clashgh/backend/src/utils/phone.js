/**
 * Ghana phone number helpers.
 * Local display format: 0XXXXXXXXX (10 digits, starts with 0)
 * Stored (E.164):       +233XXXXXXXXX
 * Provider prefixes mirror the DB CHECK users_provider_consistency
 * in migration 001 — keep the two in sync.
 */

const PROVIDER_PREFIXES = {
  mtn: ['24', '25', '53', '54', '55', '59'],
  vodafone: ['20', '50'],
  airteltigo: ['26', '27', '28', '56', '57'],
};

const E164_RE = /^\+233[0-9]{9}$/;
const LOCAL_RE = /^0[0-9]{9}$/;

/**
 * Normalize user input to E.164. Accepts '0XXXXXXXXX' or
 * '+233XXXXXXXXX' (whitespace ignored). Returns null when invalid.
 */
export function toE164(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().replace(/[\s-]/g, '');
  if (E164_RE.test(trimmed)) return trimmed;
  if (LOCAL_RE.test(trimmed)) return `+233${trimmed.slice(1)}`;
  return null;
}

/**
 * Detect the MoMo provider from an E.164 Ghana number.
 * Returns 'mtn' | 'vodafone' | 'airteltigo' | null.
 */
export function detectProvider(e164) {
  const match = /^\+233([0-9]{2})[0-9]{7}$/.exec(e164);
  if (!match) return null;
  for (const [provider, prefixes] of Object.entries(PROVIDER_PREFIXES)) {
    if (prefixes.includes(match[1])) return provider;
  }
  return null;
}

/** E.164 -> local display format (0XXXXXXXXX). */
export function toLocalFormat(e164) {
  if (!E164_RE.test(e164)) return e164;
  return `0${e164.slice(4)}`;
}
