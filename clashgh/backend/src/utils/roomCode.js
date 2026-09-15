import crypto from 'node:crypto';

/**
 * Room code generation (agent.md §9).
 * Charset: A-Z minus I, O, L (per the guide + the DB CHECK
 * `matches_room_code_format`: `^[A-HJ-KM-NP-Z2-9]{6}$`) plus 2-9 (no 0, 1).
 * 6 characters → 31^6 ≈ 887 million combinations; the matches table has a
 * UNIQUE constraint on room_code, and the activation path retries on a
 * collision (astronomically unlikely, but the DB is the backstop).
 */
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRoomCode() {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CHARSET[bytes[i] % CHARSET.length];
  return code;
}
