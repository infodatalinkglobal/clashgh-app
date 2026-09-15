import pg from 'pg';
import { env } from '../config/env.js';

/**
 * Shared pg pool. All queries in this codebase go through it with
 * parameterized statements — never string concatenation.
 */
export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
  // A hung query must never wedge a sweeper (their in-flight guards would
  // then silence that sweeper for good). 20s is generous for every query here.
  statement_timeout: 20_000,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});
