// ============================================================
// Standardized API Response Helpers
// ============================================================
// Ensures every response from the API follows a consistent
// structure. Makes Flutter client parsing predictable.
//
// Success: { success: true,  data: {...}, meta?: {...} }
// Error:   { success: false, error: { message, code, details } }
// ============================================================

/**
 * Send a successful response.
 * @param {import('express').Response} res
 * @param {object} data - Response payload
 * @param {number} [status=200] - HTTP status code
 * @param {object} [meta] - Optional metadata (pagination, timing, etc.)
 */
export function success(res, data, status = 200, meta = null) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

/**
 * Send a created (201) response.
 * @param {import('express').Response} res
 * @param {object} data - The created resource
 */
export function created(res, data) {
  return success(res, data, 201);
}

/**
 * Send an error response.
 * @param {import('express').Response} res
 * @param {string} message - Human-readable error message
 * @param {number} [status=500] - HTTP status code
 * @param {string} [code] - Machine-readable error code (e.g. 'VALIDATION_FAILED')
 * @param {Array|object} [details] - Additional error details
 */
export function error(res, message, status = 500, code = null, details = null) {
  const body = {
    success: false,
    error: {
      message,
      ...(code && { code }),
      ...(details && { details }),
    },
  };
  return res.status(status).json(body);
}

/**
 * Send a validation error (400).
 * @param {import('express').Response} res
 * @param {Array<string>} errors - List of validation error messages
 */
export function validationError(res, errors) {
  return error(res, 'Validation failed', 400, 'VALIDATION_FAILED', errors);
}

/**
 * Send a not-found error (404).
 * @param {import('express').Response} res
 * @param {string} [resource='Resource'] - What wasn't found
 */
export function notFound(res, resource = 'Resource') {
  return error(res, `${resource} not found`, 404, 'NOT_FOUND');
}
