// ============================================================
// Structured Logger
// ============================================================
// Simple, dependency-free structured logging with levels,
// timestamps, and request context.
// ============================================================

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'] || 0;

/**
 * Format a log entry as a structured string.
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} tag - Module/component identifier
 * @param {string} message
 * @param {object} [extra] - Additional context data
 */
function log(level, tag, message, extra = null) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    tag,
    message,
    ...(extra && { data: extra }),
  };

  const prefix = `[${entry.timestamp}] [${entry.level}] [${tag}]`;

  if (level === 'error') {
    console.error(`${prefix} ${message}`, extra || '');
  } else if (level === 'warn') {
    console.warn(`${prefix} ${message}`, extra || '');
  } else {
    console.log(`${prefix} ${message}`, extra ? JSON.stringify(extra) : '');
  }
}

export const logger = {
  debug: (tag, msg, extra) => log('debug', tag, msg, extra),
  info:  (tag, msg, extra) => log('info',  tag, msg, extra),
  warn:  (tag, msg, extra) => log('warn',  tag, msg, extra),
  error: (tag, msg, extra) => log('error', tag, msg, extra),
};
