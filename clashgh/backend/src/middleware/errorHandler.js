/**
 * Standard API error + handlers. Every response in the project uses
 * the exact shape: { success, data, message }.
 */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Wrap async route handlers so rejections hit the error handler. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, data: null, message: 'Endpoint not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Unique-violation (23505) is only ever intentional behind
  // username/phone claims — convert to a friendly 409 when the route
  // did not handle it itself.
  const status = err.status || (err.code === '23505' ? 409 : 500);
  const message =
    status === 500 ? 'Internal server error' : err.code === '23505' ? 'Already in use' : err.message;

  if (status === 500) console.error('[error]', err);
  res.status(status).json({ success: false, data: null, message });
}
