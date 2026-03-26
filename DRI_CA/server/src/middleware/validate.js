// ============================================================
// Request Validation Middleware Factory
// ============================================================
// Creates Express middleware that validates req.body, req.query,
// or req.params against a schema definition. Keeps validation
// logic out of route handlers.
//
// Usage:
//   router.post('/', validate(bodySchema), handler);
// ============================================================

import { validationError } from '../utils/apiResponse.js';

/**
 * @typedef {Object} FieldSchema
 * @property {string}   type       - 'string' | 'number' | 'boolean' | 'array'
 * @property {boolean}  [required] - Whether the field is required (default: false)
 * @property {number}   [min]      - Minimum value (number) or min length (string)
 * @property {number}   [max]      - Maximum value (number) or max length (string)
 * @property {Array}    [enum]     - Allowed values
 * @property {string}   [label]    - Human-readable field name for error messages
 */

/**
 * Creates a validation middleware for request body.
 *
 * @param {Object<string, FieldSchema>} schema - Map of field names to schemas
 * @param {'body'|'query'|'params'} [source='body'] - Where to read from
 * @returns {import('express').RequestHandler}
 *
 * @example
 * const schema = {
 *   latitude:     { type: 'number', required: true, min: -90, max: 90, label: 'Latitude' },
 *   buildingType: { type: 'string', required: true, enum: ['residential', 'commercial'] },
 * };
 * router.post('/', validate(schema), handler);
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source];
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = data?.[field];
      const label = rules.label || field;

      // ── Required check ──
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${label} is required`);
        continue;
      }

      // Skip optional fields that aren't provided
      if (value === undefined || value === null || value === '') continue;

      // ── Type check ──
      if (rules.type === 'number') {
        const num = typeof value === 'string' ? parseFloat(value) : value;
        if (typeof num !== 'number' || isNaN(num)) {
          errors.push(`${label} must be a valid number`);
          continue;
        }
        if (rules.min !== undefined && num < rules.min) {
          errors.push(`${label} must be at least ${rules.min}`);
        }
        if (rules.max !== undefined && num > rules.max) {
          errors.push(`${label} must be at most ${rules.max}`);
        }
      }

      if (rules.type === 'string') {
        if (typeof value !== 'string') {
          errors.push(`${label} must be a string`);
          continue;
        }
        if (rules.min !== undefined && value.length < rules.min) {
          errors.push(`${label} must be at least ${rules.min} characters`);
        }
        if (rules.max !== undefined && value.length > rules.max) {
          errors.push(`${label} must be at most ${rules.max} characters`);
        }
      }

      // ── Enum check ──
      if (rules.enum) {
        const checkValue = typeof value === 'string' ? value.toLowerCase() : value;
        if (!rules.enum.includes(checkValue)) {
          errors.push(`${label} must be one of: ${rules.enum.join(', ')}`);
        }
      }
    }

    if (errors.length > 0) {
      return validationError(res, errors);
    }

    next();
  };
}
