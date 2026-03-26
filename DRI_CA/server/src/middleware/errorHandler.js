// ============================================================
// Centralized Error Handler Middleware
// ============================================================
// Catches all unhandled errors from route handlers and returns
// a consistent JSON error response.
// ============================================================

/**
 * Express error-handling middleware.
 * Must have 4 parameters (err, req, res, next) to be recognized
 * as an error handler by Express.
 */
export function errorHandler(err, req, res, _next) {
  // Log the full error in development
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  res.status(statusCode).json({
    success: false,
    error: {
      message: err.message || 'Internal server error',
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  });
}
