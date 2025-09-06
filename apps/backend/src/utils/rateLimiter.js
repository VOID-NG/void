// Simple in-memory per-minute rate limiter for lightweight external API usage
// Usage:
//   const { tryConsume } = require('./rateLimiter');
//   const { allowed, waitMs, remaining } = tryConsume('gemini', 15);
//   if (!allowed) { /* handle backoff */ }

const bucketState = new Map();

/**
 * Try to consume one token from the named bucket with a per-minute limit.
 * Resets counts on minute boundaries.
 * @param {string} name - Bucket name (e.g., 'gemini')
 * @param {number} limitPerMinute - Max tokens per minute
 * @returns {{ allowed: boolean, remaining: number, waitMs: number }}
 */
function tryConsume(name, limitPerMinute) {
  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);
  let state = bucketState.get(name);

  if (!state || state.minute !== currentMinute) {
    state = { minute: currentMinute, count: 0 };
  }

  if (state.count < limitPerMinute) {
    state.count += 1;
    bucketState.set(name, state);
    return {
      allowed: true,
      remaining: Math.max(0, limitPerMinute - state.count),
      waitMs: 0
    };
  }

  // Compute ms until next minute window
  const nextWindowMs = (currentMinute + 1) * 60000 - now;
  bucketState.set(name, state);
  return {
    allowed: false,
    remaining: 0,
    waitMs: nextWindowMs
  };
}

module.exports = { tryConsume };