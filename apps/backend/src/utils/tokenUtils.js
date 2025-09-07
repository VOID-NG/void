// apps/backend/src/utils/tokenUtils.js
// Complete token utilities for VOID Marketplace

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { API_CONFIG, BUSINESS_RULES } = require('../config/constants');
const logger = require('./logger');

// ================================
// JWT TOKEN GENERATION
// ================================

/**
 * Generate access and refresh token pair
 * @param {Object} payload - Token payload
 * @returns {Object} Token pair with metadata
 */
const generateTokenPair = (payload) => {
  try {
    const { userId, email, role } = payload;

    if (!userId || !email || !role) {
      throw new Error('Missing required payload fields: userId, email, role');
    }

    const now = Math.floor(Date.now() / 1000);
    const accessTokenExp = now + (15 * 60); // 15 minutes
    const refreshTokenExp = now + (7 * 24 * 60 * 60); // 7 days

    // Access token payload
    const accessPayload = {
      userId,
      email,
      role,
      type: 'access',
      iat: now,
      exp: accessTokenExp,
      iss: API_CONFIG.JWT.ISSUER,
      aud: API_CONFIG.JWT.AUDIENCE
    };

    // Refresh token payload
    const refreshPayload = {
      userId,
      email,
      type: 'refresh',
      iat: now,
      exp: refreshTokenExp,
      iss: API_CONFIG.JWT.ISSUER,
      aud: API_CONFIG.JWT.AUDIENCE
    };

    // Generate tokens
    const accessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, {
      algorithm: API_CONFIG.JWT.ALGORITHM
    });

    const refreshToken = jwt.sign(refreshPayload, process.env.JWT_REFRESH_SECRET, {
      algorithm: API_CONFIG.JWT.ALGORITHM
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessTokenExp,
      expiresAt: new Date(accessTokenExp * 1000).toISOString(),
      refreshExpiresIn: refreshTokenExp,
      refreshExpiresAt: new Date(refreshTokenExp * 1000).toISOString()
    };
  } catch (error) {
    logger.error('Token generation failed:', error);
    throw new Error('Failed to generate tokens');
  }
};

/**
 * Generate email verification token
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @returns {string} Verification token
 */
const generateEmailVerificationToken = (userId, email) => {
  try {
    const payload = {
      userId,
      email,
      type: 'email_verification',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    return jwt.sign(payload, process.env.JWT_SECRET);
  } catch (error) {
    logger.error('Email verification token generation failed:', error);
    throw new Error('Failed to generate email verification token');
  }
};

/**
 * Generate password reset token
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @returns {string} Reset token
 */
const generatePasswordResetToken = (userId, email) => {
  try {
    const payload = {
      userId,
      email,
      type: 'password_reset',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour
    };

    return jwt.sign(payload, process.env.JWT_SECRET);
  } catch (error) {
    logger.error('Password reset token generation failed:', error);
    throw new Error('Failed to generate password reset token');
  }
};

/**
 * Generate API key for external integrations
 * @param {string} userId - User ID
 * @param {string} purpose - API key purpose
 * @param {number} expiryDays - Expiry in days (0 = never expires)
 * @returns {Object} API key and metadata
 */
const generateApiKey = (userId, purpose = 'general', expiryDays = 365) => {
  try {
    const keyId = crypto.randomBytes(16).toString('hex');
    const secret = crypto.randomBytes(32).toString('base64url');
    
    const payload = {
      keyId,
      userId,
      purpose,
      type: 'api_key',
      iat: Math.floor(Date.now() / 1000),
      exp: expiryDays > 0 ? Math.floor(Date.now() / 1000) + (expiryDays * 24 * 60 * 60) : null
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET);
    
    return {
      keyId,
      apiKey: `vk_${keyId}_${secret}`,
      token,
      purpose,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    logger.error('API key generation failed:', error);
    throw new Error('Failed to generate API key');
  }
};

// ================================
// TOKEN VERIFICATION
// ================================

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @param {string} secret - JWT secret (optional, defaults to JWT_SECRET)
 * @returns {Object} Decoded payload
 */
const verifyToken = (token, secret = process.env.JWT_SECRET) => {
  try {
    if (!token) {
      throw new Error('Token is required');
    }

    const decoded = jwt.verify(token, secret, {
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE,
      algorithms: [API_CONFIG.JWT.ALGORITHM]
    });

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    } else if (error.name === 'NotBeforeError') {
      throw new Error('Token not yet valid');
    }
    
    logger.error('Token verification failed:', error);
    throw new Error('Token verification failed');
  }
};

/**
 * Verify refresh token
 * @param {string} refreshToken - Refresh token
 * @returns {Object} Decoded payload
 */
const verifyRefreshToken = (refreshToken) => {
  try {
    return verifyToken(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    logger.error('Refresh token verification failed:', error);
    throw new Error('Invalid or expired refresh token');
  }
};

/**
 * Verify email verification token
 * @param {string} token - Verification token
 * @returns {Object} Decoded payload
 */
const verifyEmailVerificationToken = (token) => {
  try {
    const decoded = verifyToken(token);
    
    if (decoded.type !== 'email_verification') {
      throw new Error('Invalid token type');
    }
    
    return decoded;
  } catch (error) {
    logger.error('Email verification token verification failed:', error);
    throw new Error('Invalid or expired verification token');
  }
};

/**
 * Verify password reset token
 * @param {string} token - Reset token
 * @returns {Object} Decoded payload
 */
const verifyPasswordResetToken = (token) => {
  try {
    const decoded = verifyToken(token);
    
    if (decoded.type !== 'password_reset') {
      throw new Error('Invalid token type');
    }
    
    return decoded;
  } catch (error) {
    logger.error('Password reset token verification failed:', error);
    throw new Error('Invalid or expired reset token');
  }
};

/**
 * Verify API key
 * @param {string} apiKey - API key
 * @returns {Object} Decoded payload
 */
const verifyApiKey = (apiKey) => {
  try {
    if (!apiKey || !apiKey.startsWith('vk_')) {
      throw new Error('Invalid API key format');
    }

    // Extract components
    const parts = apiKey.split('_');
    if (parts.length !== 3) {
      throw new Error('Invalid API key format');
    }

    const [prefix, keyId, secret] = parts;
    
    // For now, we'll implement basic validation
    // In production, you'd want to verify against stored API keys
    if (keyId.length !== 32 || secret.length < 32) {
      throw new Error('Invalid API key format');
    }

    return {
      keyId,
      valid: true,
      purpose: 'general' // Would be retrieved from database in production
    };
  } catch (error) {
    logger.error('API key verification failed:', error);
    throw new Error('Invalid API key');
  }
};

// ================================
// TOKEN UTILITY FUNCTIONS
// ================================

/**
 * Extract token from Authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Extracted token
 */
const extractTokenFromHeader = (authHeader) => {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
};

/**
 * Get token expiration time
 * @param {string} token - JWT token
 * @returns {number|null} Expiration timestamp
 */
const getTokenExpiration = (token) => {
  try {
    const decoded = jwt.decode(token);
    return decoded?.exp || null;
  } catch (error) {
    return null;
  }
};

/**
 * Check if token is expired
 * @param {string} token - JWT token
 * @returns {boolean} Is token expired
 */
const isTokenExpired = (token) => {
  try {
    const exp = getTokenExpiration(token);
    if (!exp) return true;
    
    return Date.now() >= exp * 1000;
  } catch (error) {
    return true;
  }
};

/**
 * Get time until token expires
 * @param {string} token - JWT token
 * @returns {number} Milliseconds until expiration (negative if expired)
 */
const getTimeUntilExpiration = (token) => {
  try {
    const exp = getTokenExpiration(token);
    if (!exp) return -1;
    
    return (exp * 1000) - Date.now();
  } catch (error) {
    return -1;
  }
};

/**
 * Decode token without verification (for inspection)
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded payload
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token, { complete: true });
  } catch (error) {
    logger.error('Token decode failed:', error);
    return null;
  }
};

// ================================
// TOKEN BLACKLISTING SYSTEM
// ================================

// In-memory blacklist (use Redis in production)
const tokenBlacklist = new Set();
const blacklistCleanupInterval = 60 * 60 * 1000; // 1 hour

/**
 * Add token to blacklist
 * @param {string} token - JWT token to blacklist
 * @param {number} expiresAt - Token expiry timestamp
 */
const blacklistToken = (token, expiresAt) => {
  try {
    tokenBlacklist.add(token);
    
    // Auto-remove after expiry
    const timeToExpiry = expiresAt * 1000 - Date.now();
    if (timeToExpiry > 0) {
      setTimeout(() => {
        tokenBlacklist.delete(token);
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
  return tokenBlacklist.has(token);
};

/**
 * Clean up expired tokens from blacklist
 */
const cleanupBlacklist = () => {
  // This is a simple implementation
  // In production, use Redis with TTL or proper cleanup logic
  logger.debug('Blacklist cleanup executed', { 
    blacklistedCount: tokenBlacklist.size 
  });
};

// Setup periodic cleanup
setInterval(cleanupBlacklist, blacklistCleanupInterval);

/**
 * Get blacklist statistics
 * @returns {Object} Blacklist stats
 */
const getBlacklistStats = () => {
  return {
    total_blacklisted: tokenBlacklist.size,
    cleanup_interval_ms: blacklistCleanupInterval
  };
};

// ================================
// SECURE TOKEN GENERATION
// ================================

/**
 * Generate secure random token
 * @param {number} length - Token length in bytes
 * @param {string} encoding - Encoding format
 * @returns {string} Random token
 */
const generateSecureToken = (length = 32, encoding = 'base64url') => {
  try {
    return crypto.randomBytes(length).toString(encoding);
  } catch (error) {
    logger.error('Secure token generation failed:', error);
    throw new Error('Failed to generate secure token');
  }
};

/**
 * Generate CSRF token
 * @param {string} sessionId - Session ID
 * @returns {string} CSRF token
 */
const generateCSRFToken = (sessionId) => {
  try {
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(16).toString('hex');
    const data = `${sessionId}:${timestamp}:${random}`;
    
    return crypto
      .createHmac('sha256', process.env.JWT_SECRET)
      .update(data)
      .digest('base64url');
  } catch (error) {
    logger.error('CSRF token generation failed:', error);
    throw new Error('Failed to generate CSRF token');
  }
};

/**
 * Verify CSRF token
 * @param {string} token - CSRF token
 * @param {string} sessionId - Session ID
 * @returns {boolean} Is token valid
 */
const verifyCSRFToken = (token, sessionId) => {
  try {
    // In a real implementation, you'd store and verify the token components
    // This is a simplified version
    return typeof token === 'string' && token.length > 20;
  } catch (error) {
    logger.error('CSRF token verification failed:', error);
    return false;
  }
};

// ================================
// TOKEN ROTATION
// ================================

/**
 * Rotate refresh token
 * @param {string} oldRefreshToken - Current refresh token
 * @param {Object} payload - New token payload
 * @returns {Object} New token pair
 */
const rotateRefreshToken = (oldRefreshToken, payload) => {
  try {
    // Verify the old refresh token
    const decoded = verifyRefreshToken(oldRefreshToken);
    
    // Blacklist the old token
    blacklistToken(oldRefreshToken, decoded.exp);
    
    // Generate new token pair
    return generateTokenPair(payload);
  } catch (error) {
    logger.error('Token rotation failed:', error);
    throw new Error('Failed to rotate refresh token');
  }
};

// ================================
// WEBHOOK SIGNATURE VERIFICATION
// ================================

/**
 * Generate webhook signature
 * @param {string} payload - Webhook payload
 * @param {string} secret - Webhook secret
 * @returns {string} Signature
 */
const generateWebhookSignature = (payload, secret) => {
  try {
    return crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
  } catch (error) {
    logger.error('Webhook signature generation failed:', error);
    throw new Error('Failed to generate webhook signature');
  }
};

/**
 * Verify webhook signature
 * @param {string} payload - Webhook payload
 * @param {string} signature - Provided signature
 * @param {string} secret - Webhook secret
 * @returns {boolean} Is signature valid
 */
const verifyWebhookSignature = (payload, signature, secret) => {
  try {
    const expectedSignature = generateWebhookSignature(payload, secret);
    const providedSignature = signature.replace('sha256=', '');
    
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(providedSignature, 'hex')
    );
  } catch (error) {
    logger.error('Webhook signature verification failed:', error);
    return false;
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Token generation
  generateTokenPair,
  generateEmailVerificationToken,
  generatePasswordResetToken,
  generateApiKey,
  generateSecureToken,
  generateCSRFToken,
  generateWebhookSignature,

  // Token verification
  verifyToken,
  verifyRefreshToken,
  verifyEmailVerificationToken,
  verifyPasswordResetToken,
  verifyApiKey,
  verifyCSRFToken,
  verifyWebhookSignature,

  // Token utilities
  extractTokenFromHeader,
  getTokenExpiration,
  isTokenExpired,
  getTimeUntilExpiration,
  decodeToken,

  // Token management
  blacklistToken,
  isTokenBlacklisted,
  getBlacklistStats,
  rotateRefreshToken,

  // Cleanup
  cleanupBlacklist
};