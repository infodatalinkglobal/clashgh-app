import pg from 'pg';
import { env } from '../config/env.js';

/**
 * Shared pg pool. All queries in this codebase go through it with
 * parameterized statements — never string concatenation.
 */
export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});
