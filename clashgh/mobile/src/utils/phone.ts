/**
 * Ghana phone helpers (agent.md §3 canonical prefix list).
 *
 * Stored format: E.164 (+233XXXXXXXXX). Display format: 0XXXXXXXXX.
 * The backend applies the same list — the app mirrors it so the user
 * sees the detected provider BEFORE submitting.
 */
export type MomoProvider = 'mtn' | 'vodafone' | 'airteltigo';

const PREFIXES: Record<MomoProvider, string[]> = {
  mtn: ['024', '025', '053', '054', '055', '059'],
  vodafone: ['020', '050'],
  airteltigo: ['026', '027', '028', '056', '057'],
};

const PROVIDER_LABELS: Record<MomoProvider, string> = {
  mtn: 'MTN MoMo',
  vodafone: 'Telecel MoMo',
  airteltigo: 'AirtelTigo Money',
};

/** Normalize user input to E.164, or null when not a Ghana number. */
export function toE164(input: string): string | null {
  let digits = input.replace(/[^\d]/g, '');
  if (digits.startsWith('233') && digits.length === 13) {
    digits = '0' + digits.slice(3);
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return `+233${digits.slice(1)}`;
  }
  return null;
}

/** Detect the MoMo provider from a local (0XXXXXXXXX) or E.164 number. */
export function detectProvider(input: string): MomoProvider | null {
  const e164 = toE164(input);
  if (!e164) return null;
  const local = `0${e164.slice(4)}`; // +233XXXXXXXXX → 0XXXXXXXXX
  const prefix = local.slice(0, 3);
  for (const [provider, prefixes] of Object.entries(PREFIXES) as [
    MomoProvider,
    string[],
  ][]) {
    if (prefixes.includes(prefix)) return provider;
  }
  return null;
}

export function providerLabel(provider: MomoProvider): string {
  return PROVIDER_LABELS[provider];
}

/** Display format for the user: 0XXXXXXXXX (from E.164). */
export function toLocalDisplay(e164: string | null): string | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('233')) return `0${digits.slice(3)}`;
  return e164;
}

/** Validate a candidate username (same rules as the backend). */
export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(username);
}
