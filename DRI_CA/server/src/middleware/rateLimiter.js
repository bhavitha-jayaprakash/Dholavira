// ============================================================
// Rate Limiter Middleware
// ============================================================
// Wraps express-rate-limit with sensible defaults and a
// JSON error response that matches our API format.
// ============================================================

import rateLimit from 'express-rate-limit';

/**
 * Creates a rate limiter middleware.
 *
 * @param {object} [options]
 * @param {number} [options.windowMs]  - Time window in milliseconds (default: 15 min)
 * @param {number} [options.max]       - Max requests per window (default: 100)
 * @param {string} [options.message]   - Custom error message
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs
    || parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
    || 15 * 60 * 1000; // 15 minutes

  const max = options.max
    || parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10)
    || 100;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,   // Send `RateLimit-*` headers
    legacyHeaders: false,    // Don't send `X-RateLimit-*`
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: {
          message: options.message || 'Too many requests. Please try again later.',
          code: 'RATE_LIMITED',
        },
      });
    },
  });
}
