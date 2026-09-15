/**
 * Small shared validators. Keep in sync with the DB CHECK
 * constraints (migration 001) so users get a 400 with a friendly
 * message instead of a leaked constraint error.
 */

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const EMAIL_RE = /^\S+@\S+\.\S+$/;
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GAME_TYPES = ['efootball', 'fc_mobile', 'codm', 'dls'];

