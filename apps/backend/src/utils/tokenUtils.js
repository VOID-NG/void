// apps/backend/src/utils/tokenUtils.js
// JWT token utilities for VOID Marketplace

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { API_CONFIG } = require('../config/constants');
const logger = require('./logger');

// ================================
// TOKEN GENERATION
// ================================

/**
 * Generate access token
 * @param {Object} payload - Token payload
 * @param {string} payload.userId - User ID
 * @param {string} payload.email - User email
 * @param {string} payload.role - User role
 * @returns {string} JWT access token
 */
const generateAccessToken = (payload) => {
  try {
    const tokenPayload = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      type: 'access'
    };

    return jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: API_CONFIG.JWT.ACCESS_TOKEN_EXPIRY,
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE,
      subject: payload.userId
    });
  } catch (error) {
    logger.error('Error generating access token:', error);
    throw new Error('Token generation failed');
  }
};

/**
 * Generate refresh token
 * @param {Object} payload - Token payload
 * @param {string} payload.userId - User ID
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (payload) => {
  try {
    const tokenPayload = {
      userId: payload.userId,
      type: 'refresh',
      tokenId: crypto.randomUUID() // Unique ID for token tracking
    };

    return jwt.sign(tokenPayload, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
      expiresIn: API_CONFIG.JWT.REFRESH_TOKEN_EXPIRY,
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE,
      subject: payload.userId
    });
  } catch (error) {
    logger.error('Error generating refresh token:', error);
    throw new Error('Token generation failed');
  }
};

/**
 * Generate email verification token
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @returns {string} Email verification token
 */
const generateEmailVerificationToken = (userId, email) => {
  try {
    const payload = {
      userId,
      email,
      type: 'email_verification',
      timestamp: Date.now()
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '24h',
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE,
      subject: userId
    });
  } catch (error) {
    logger.error('Error generating email verification token:', error);
    throw new Error('Token generation failed');
  }
};

/**
 * Generate password reset token
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @returns {string} Password reset token
 */
const generatePasswordResetToken = (userId, email) => {
  try {
    const payload = {
      userId,
      email,
      type: 'password_reset',
      timestamp: Date.now()
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '1h',
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE,
      subject: userId
    });
  } catch (error) {
    logger.error('Error generating password reset token:', error);
    throw new Error('Token generation failed');
  }
};

// ================================
// TOKEN VERIFICATION
// ================================

/**
 * Verify access token
 * @param {string} token - JWT token
 * @returns {Object} Decoded token payload
 */
const verifyAccessToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE
    });

    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    logger.debug('Access token verification failed:', error.message);
    throw error;
  }
};

/**
 * Verify refresh token
 * @param {string} token - JWT refresh token
 * @returns {Object} Decoded token payload
 */
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE
    });

    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    logger.debug('Refresh token verification failed:', error.message);
    throw error;
  }
};

/**
 * Verify email verification token
 * @param {string} token - Email verification token
 * @returns {Object} Decoded token payload
 */
const verifyEmailVerificationToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE
    });

    if (decoded.type !== 'email_verification') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    logger.debug('Email verification token verification failed:', error.message);
    throw error;
  }
};

/**
 * Verify password reset token
 * @param {string} token - Password reset token
 * @returns {Object} Decoded token payload
 */
const verifyPasswordResetToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE
    });

    if (decoded.type !== 'password_reset') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    logger.debug('Password reset token verification failed:', error.message);
    throw error;
  }
};

// ================================
// TOKEN UTILITIES
// ================================

/**
 * Decode token without verification (for debugging)
 * @param {string} token - JWT token
 * @returns {Object} Decoded token payload
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token, { complete: true });
  } catch (error) {
    logger.debug('Token decode failed:', error.message);
    return null;
  }
};

/**
 * Check if token is expired without verification
 * @param {string} token - JWT token
 * @returns {boolean} True if expired
 */
const isTokenExpired = (token) => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) {
      return true;
    }
    
    const currentTime = Math.floor(Date.now() / 1000);
    return decoded.exp < currentTime;
  } catch (error) {
    return true;
  }
};

/**
 * Get token expiration time
 * @param {string} token - JWT token
 * @returns {Date|null} Expiration date
 */
const getTokenExpiration = (token) => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) {
      return null;
    }
    
    return new Date(decoded.exp * 1000);
  } catch (error) {
    return null;
  }
};

/**
 * Extract token from Authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Extracted token
 */
const extractTokenFromHeader = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  return authHeader.split(' ')[1];
};

// ================================
// API KEY GENERATION
// ================================

/**
 * Generate API key for external integrations
 * @param {string} userId - User ID
 * @param {string} purpose - API key purpose
 * @returns {string} API key
 */
const generateApiKey = (userId, purpose = 'general') => {
  try {
    const payload = {
      userId,
      purpose,
      type: 'api_key',
      timestamp: Date.now(),
      keyId: crypto.randomUUID()
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '365d', // API keys last 1 year
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE,
      subject: userId
    });
  } catch (error) {
    logger.error('Error generating API key:', error);
    throw new Error('API key generation failed');
  }
};

/**
 * Verify API key
 * @param {string} apiKey - API key
 * @returns {Object} Decoded API key payload
 */
const verifyApiKey = (apiKey) => {
  try {
    const decoded = jwt.verify(apiKey, process.env.JWT_SECRET, {
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE
    });

    if (decoded.type !== 'api_key') {
      throw new Error('Invalid key type');
    }

    return decoded;
  } catch (error) {
    logger.debug('API key verification failed:', error.message);
    throw error;
  }
};

// ================================
// TOKEN BLACKLIST MANAGEMENT
// ================================

// In-memory blacklist (use Redis in production)
const tokenBlacklist = new Map();

/**
 * Add token to blacklist
 * @param {string} token - Token to blacklist
 * @param {number} expirationTime - Token expiration timestamp
 */
const blacklistToken = (token, expirationTime) => {
  tokenBlacklist.set(token, expirationTime);
  
  // Clean up expired tokens periodically
  setTimeout(() => {
    if (tokenBlacklist.get(token) <= Date.now()) {
      tokenBlacklist.delete(token);
    }
  }, expirationTime - Date.now());
};

/**
 * Check if token is blacklisted
 * @param {string} token - Token to check
 * @returns {boolean} True if blacklisted
 */
const isTokenBlacklisted = (token) => {
  const expirationTime = tokenBlacklist.get(token);
  
  if (!expirationTime) {
    return false;
  }
  
  // Remove if expired
  if (expirationTime <= Date.now()) {
    tokenBlacklist.delete(token);
    return false;
  }
  
  return true;
};

// ================================
// SECURITY UTILITIES
// ================================

/**
 * Generate secure random string
 * @param {number} length - String length
 * @returns {string} Random string
 */
const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Generate CSRF token
 * @returns {string} CSRF token
 */
const generateCSRFToken = () => {
  return crypto.randomBytes(16).toString('hex');
};

/**
 * Validate token format
 * @param {string} token - Token to validate
 * @returns {boolean} True if valid format
 */
const isValidTokenFormat = (token) => {
  if (!token || typeof token !== 'string') {
    return false;
  }
  
  // JWT format check (3 parts separated by dots)
  const parts = token.split('.');
  return parts.length === 3 && parts.every(part => part.length > 0);
};

// ================================
// REFRESH TOKEN ROTATION
// ================================

/**
 * Generate token pair (access + refresh)
 * @param {Object} userPayload - User data for token
 * @returns {Object} Token pair
 */
const generateTokenPair = (userPayload) => {
  const accessToken = generateAccessToken(userPayload);
  const refreshToken = generateRefreshToken(userPayload);
  
  return {
    accessToken,
    refreshToken,
    expiresIn: API_CONFIG.JWT.ACCESS_TOKEN_EXPIRY,
    tokenType: 'Bearer'
  };
};

/**
 * Refresh access token using refresh token
 * @param {string} refreshToken - Valid refresh token
 * @param {Object} userPayload - Updated user data
 * @returns {Object} New token pair
 */
const refreshAccessToken = (refreshToken, userPayload) => {
  // Verify refresh token
  const decoded = verifyRefreshToken(refreshToken);
  
  // Blacklist old refresh token
  const tokenExp = getTokenExpiration(refreshToken);
  if (tokenExp) {
    blacklistToken(refreshToken, tokenExp.getTime());
  }
  
  // Generate new token pair
  return generateTokenPair(userPayload);
};

module.exports = {
  // Token generation
  generateAccessToken,
  generateRefreshToken,
  generateEmailVerificationToken,
  generatePasswordResetToken,
  generateApiKey,
  generateTokenPair,
  
  // Token verification
  verifyAccessToken,
  verifyRefreshToken,
  verifyEmailVerificationToken,
  verifyPasswordResetToken,
  verifyApiKey,
  
  // Token utilities
  decodeToken,
  isTokenExpired,
  getTokenExpiration,
  extractTokenFromHeader,
  isValidTokenFormat,
  refreshAccessToken,
  
  // Blacklist management
  blacklistToken,
  isTokenBlacklisted,
  
  // Security utilities
  generateSecureToken,
  generateCSRFToken
};