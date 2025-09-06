// apps/backend/src/utils/tokenUtils.js
// JWT utilities, email verification tokens, password reset tokens, token blacklisting

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { promisify } = require('util');
const logger = require('./logger');

// ================================
// JWT TOKEN MANAGEMENT
// ================================

/**
 * Generate JWT access token
 * @param {Object} payload - Token payload (user info)
 * @param {string} expiresIn - Token expiration time
 * @returns {string} JWT token
 */
const generateAccessToken = (payload, expiresIn = '24h') => {
  try {
    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn,
      issuer: 'void-marketplace',
      audience: 'void-users'
    });
  } catch (error) {
    logger.error('Generate access token failed:', error);
    throw new Error('Token generation failed');
  }
};

/**
 * Generate JWT refresh token
 * @param {Object} payload - Token payload
 * @returns {string} Refresh token
 */
const generateRefreshToken = (payload) => {
  try {
    return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
      expiresIn: '7d',
      issuer: 'void-marketplace',
      audience: 'void-users'
    });
  } catch (error) {
    logger.error('Generate refresh token failed:', error);
    throw new Error('Refresh token generation failed');
  }
};

/**
 * Verify JWT token
 * @param {string} token - JWT token to verify
 * @param {string} secret - Secret key (optional, defaults to JWT_SECRET)
 * @returns {Object} Decoded token payload
 */
const verifyToken = async (token, secret = process.env.JWT_SECRET) => {
  try {
    const verify = promisify(jwt.verify);
    return await verify(token, secret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    logger.error('Token verification failed:', error);
    throw new Error('Token verification failed');
  }
};

/**
 * Decode JWT token without verification (for expired token data)
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded payload or null
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    logger.error('Token decode failed:', error);
    return null;
  }
};

// ================================
// EMAIL VERIFICATION TOKENS
// ================================

/**
 * Generate email verification token
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @returns {Object} Token data and expiry
 */
const generateEmailVerificationToken = (userId, email) => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Create verification hash
    const verificationHash = crypto
      .createHmac('sha256', process.env.EMAIL_VERIFICATION_SECRET || process.env.JWT_SECRET)
      .update(`${userId}:${email}:${token}`)
      .digest('hex');

    return {
      token,
      verification_hash: verificationHash,
      expires_at: expires,
      user_id: userId,
      email: email
    };
  } catch (error) {
    logger.error('Generate email verification token failed:', error);
    throw new Error('Email verification token generation failed');
  }
};

/**
 * Verify email verification token
 * @param {string} token - Verification token
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @returns {boolean} Is token valid
 */
const verifyEmailVerificationToken = (token, userId, email) => {
  try {
    const expectedHash = crypto
      .createHmac('sha256', process.env.EMAIL_VERIFICATION_SECRET || process.env.JWT_SECRET)
      .update(`${userId}:${email}:${token}`)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedHash, 'hex'),
      Buffer.from(token, 'hex')
    );
  } catch (error) {
    logger.error('Verify email verification token failed:', error);
    return false;
  }
};

// ================================
// PASSWORD RESET TOKENS
// ================================

/**
 * Generate password reset token
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @returns {Object} Reset token data
 */
const generatePasswordResetToken = (userId, email) => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    // Create reset hash
    const resetHash = crypto
      .createHmac('sha256', process.env.PASSWORD_RESET_SECRET || process.env.JWT_SECRET)
      .update(`${userId}:${email}:${token}:${expires.getTime()}`)
      .digest('hex');

    return {
      token,
      reset_hash: resetHash,
      expires_at: expires,
      user_id: userId,
      email: email
    };
  } catch (error) {
    logger.error('Generate password reset token failed:', error);
    throw new Error('Password reset token generation failed');
  }
};

/**
 * Verify password reset token
 * @param {string} token - Reset token
 * @param {string} resetHash - Stored reset hash
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @param {Date} expiresAt - Token expiry date
 * @returns {boolean} Is token valid and not expired
 */
const verifyPasswordResetToken = (token, resetHash, userId, email, expiresAt) => {
  try {
    // Check if token is expired
    if (new Date() > new Date(expiresAt)) {
      return false;
    }

    const expectedHash = crypto
      .createHmac('sha256', process.env.PASSWORD_RESET_SECRET || process.env.JWT_SECRET)
      .update(`${userId}:${email}:${token}:${new Date(expiresAt).getTime()}`)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(resetHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  } catch (error) {
    logger.error('Verify password reset token failed:', error);
    return false;
  }
};

// ================================
// TOKEN BLACKLISTING (In-Memory Store)
// ================================

// In-memory blacklist store (use Redis in production)
const blacklistedTokens = new Set();
const blacklistCleanupInterval = 60 * 60 * 1000; // 1 hour

/**
 * Add token to blacklist
 * @param {string} token - JWT token to blacklist
 * @param {number} expiresAt - Token expiry timestamp
 */
const blacklistToken = (token, expiresAt) => {
  try {
    blacklistedTokens.add(token);
    
    // Auto-remove after expiry
    const timeToExpiry = expiresAt * 1000 - Date.now();
    if (timeToExpiry > 0) {
      setTimeout(() => {
        blacklistedTokens.delete(token);
      }, timeToExpiry);
    }

    logger.info('Token blacklisted', { 
      tokenPrefix: token.substring(0, 10) + '...',
      expiresAt: new Date(expiresAt * 1000).toISOString()
    });
  } catch (error) {
    logger.error('Blacklist token failed:', error);
  }
};

/**
 * Check if token is blacklisted
 * @param {string} token - JWT token to check
 * @returns {boolean} Is token blacklisted
 */
const isTokenBlacklisted = (token) => {
  return blacklistedTokens.has(token);
};

/**
 * Clean up expired tokens from blacklist
 */
const cleanupBlacklist = () => {
  // This is a simple implementation
  // In production, use Redis with TTL or proper cleanup logic
  logger.info('Blacklist cleanup executed', { 
    blacklistedCount: blacklistedTokens.size 
  });
};

// Setup periodic cleanup
setInterval(cleanupBlacklist, blacklistCleanupInterval);

// ================================
// API KEY GENERATION (For webhooks, etc.)
// ================================

/**
 * Generate secure API key
 * @param {string} prefix - Key prefix (e.g., 'webhook_', 'api_')
 * @returns {string} API key
 */
const generateApiKey = (prefix = 'api_') => {
  try {
    const randomBytes = crypto.randomBytes(32);
    const apiKey = `${prefix}${randomBytes.toString('hex')}`;
    return apiKey;
  } catch (error) {
    logger.error('Generate API key failed:', error);
    throw new Error('API key generation failed');
  }
};

/**
 * Hash API key for storage
 * @param {string} apiKey - API key to hash
 * @returns {string} Hashed API key
 */
const hashApiKey = (apiKey) => {
  try {
    return crypto
      .createHash('sha256')
      .update(apiKey + (process.env.API_KEY_SALT || process.env.JWT_SECRET))
      .digest('hex');
  } catch (error) {
    logger.error('Hash API key failed:', error);
    throw new Error('API key hashing failed');
  }
};

/**
 * Verify API key
 * @param {string} apiKey - API key to verify
 * @param {string} hashedKey - Stored hashed key
 * @returns {boolean} Is API key valid
 */
const verifyApiKey = (apiKey, hashedKey) => {
  try {
    const computedHash = hashApiKey(apiKey);
    return crypto.timingSafeEqual(
      Buffer.from(hashedKey, 'hex'),
      Buffer.from(computedHash, 'hex')
    );
  } catch (error) {
    logger.error('Verify API key failed:', error);
    return false;
  }
};

// ================================
// RATE LIMITING TOKENS
// ================================

/**
 * Generate rate limiting token for temporary access
 * @param {string} identifier - IP or user identifier
 * @param {number} expiresIn - Expiry in seconds
 * @returns {string} Rate limit token
 */
const generateRateLimitToken = (identifier, expiresIn = 3600) => {
  try {
    const payload = {
      identifier,
      type: 'rate_limit',
      iat: Math.floor(Date.now() / 1000)
    };

    return jwt.sign(payload, process.env.RATE_LIMIT_SECRET || process.env.JWT_SECRET, {
      expiresIn,
      issuer: 'void-marketplace'
    });
  } catch (error) {
    logger.error('Generate rate limit token failed:', error);
    throw new Error('Rate limit token generation failed');
  }
};

// ================================
// TOKEN UTILITIES
// ================================

/**
 * Extract token from Authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Extracted token or null
 */
const extractTokenFromHeader = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
};

/**
 * Generate secure random token
 * @param {number} length - Token length in bytes
 * @returns {string} Random token
 */
const generateSecureToken = (length = 32) => {
  try {
    return crypto.randomBytes(length).toString('hex');
  } catch (error) {
    logger.error('Generate secure token failed:', error);
    throw new Error('Secure token generation failed');
  }
};

/**
 * Create token expiry date
 * @param {number} hours - Hours from now
 * @returns {Date} Expiry date
 */
const createExpiryDate = (hours = 24) => {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // JWT management
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  decodeToken,

  // Email verification
  generateEmailVerificationToken,
  verifyEmailVerificationToken,

  // Password reset
  generatePasswordResetToken,
  verifyPasswordResetToken,

  // Token blacklisting
  blacklistToken,
  isTokenBlacklisted,
  cleanupBlacklist,

  // API keys
  generateApiKey,
  hashApiKey,
  verifyApiKey,

  // Rate limiting
  generateRateLimitToken,

  // Utilities
  extractTokenFromHeader,
  generateSecureToken,
  createExpiryDate
};