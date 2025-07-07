// apps/backend/src/middleware/authMiddleware.js
// JWT Authentication middleware for VOID Marketplace

const jwt = require('jsonwebtoken');
const { prisma } = require('../config/db');
const { USER_STATUS, ERROR_CODES, API_CONFIG } = require('../config/constants');
const logger = require('../utils/logger');

// ================================
// JWT TOKEN VERIFICATION
// ================================

const verifyToken = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access denied',
        code: ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'No valid token provided'
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access denied',
        code: ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'Token not found'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: API_CONFIG.JWT.ISSUER,
      audience: API_CONFIG.JWT.AUDIENCE
    });

    // Check if user exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        username: true,
        first_name: true,
        last_name: true,
        role: true,
        status: true,
        is_verified: true,
        vendor_verified: true,
        created_at: true
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
        code: ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'Token user does not exist'
      });
    }

    // Check if user account is active
    if (user.status === USER_STATUS.BANNED) {
      return res.status(403).json({
        success: false,
        error: 'Account banned',
        code: ERROR_CODES.AUTH_ACCOUNT_SUSPENDED,
        message: 'Your account has been permanently banned'
      });
    }

    if (user.status === USER_STATUS.SUSPENDED) {
      return res.status(403).json({
        success: false,
        error: 'Account suspended',
        code: ERROR_CODES.AUTH_ACCOUNT_SUSPENDED,
        message: 'Your account has been temporarily suspended'
      });
    }

    // Update last login time
    await prisma.user.update({
      where: { id: user.id },
      data: { last_login: new Date() }
    });

    // Attach user to request
    req.user = user;
    req.userId = user.id;
    
    next();
  } catch (error) {
    logger.error('Token verification error:', error);

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: ERROR_CODES.AUTH_TOKEN_EXPIRED,
        message: 'Please login again'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'Token is malformed'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Authentication error',
      message: 'Internal server error during authentication'
    });
  }
};

// ================================
// OPTIONAL AUTHENTICATION
// ================================

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    // If no token provided, continue without user
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      req.userId = null;
      return next();
    }

    // If token provided, verify it
    await verifyToken(req, res, next);
  } catch (error) {
    // On auth error with optional auth, continue without user
    req.user = null;
    req.userId = null;
    next();
  }
};

// ================================
// EMAIL VERIFICATION CHECK
// ================================

const requireEmailVerification = (req, res, next) => {
  if (!req.user.is_verified) {
    return res.status(403).json({
      success: false,
      error: 'Email verification required',
      code: ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
      message: 'Please verify your email address to access this feature'
    });
  }
  next();
};

// ================================
// VENDOR VERIFICATION CHECK
// ================================

const requireVendorVerification = (req, res, next) => {
  if (!req.user.vendor_verified && req.user.role === 'VENDOR') {
    return res.status(403).json({
      success: false,
      error: 'Vendor verification required',
      code: ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
      message: 'Please complete vendor verification to access this feature'
    });
  }
  next();
};

// ================================
// ACCOUNT OWNERSHIP CHECK
// ================================

const requireOwnership = (resourceParam = 'id', userField = 'vendor_id') => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params[resourceParam];
      const userId = req.user.id;

      // Skip ownership check for admins
      if (['SUPER_ADMIN', 'ADMIN'].includes(req.user.role)) {
        return next();
      }

      // For user-owned resources (when userField is 'user_id' or 'id')
      if (userField === 'user_id' || userField === 'id') {
        if (resourceId !== userId) {
          return res.status(403).json({
            success: false,
            error: 'Access denied',
            code: ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
            message: 'You can only access your own resources'
          });
        }
        return next();
      }

      // For other resource types, we need to check the database
      // This is a generic approach - specific controllers might override this
      req.requireOwnershipCheck = {
        resourceId,
        userField,
        userId
      };
      
      next();
    } catch (error) {
      logger.error('Ownership check error:', error);
      return res.status(500).json({
        success: false,
        error: 'Authorization error',
        message: 'Error checking resource ownership'
      });
    }
  };
};

// ================================
// RATE LIMITING FOR AUTH ENDPOINTS
// ================================

const authRateLimit = (req, res, next) => {
  // Additional rate limiting logic specific to auth endpoints
  // This can be expanded based on specific needs
  const clientIP = req.ip || req.connection.remoteAddress;
  
  // Log authentication attempts for security monitoring
  logger.info(`Auth attempt from IP: ${clientIP}, Endpoint: ${req.path}`);
  
  next();
};

// ================================
// TOKEN VALIDATION HELPER
// ================================

const validateTokenFormat = (token) => {
  if (!token || typeof token !== 'string') {
    return false;
  }

  // Basic JWT format check (3 parts separated by dots)
  const parts = token.split('.');
  return parts.length === 3;
};

// ================================
// MIDDLEWARE COMPOSITION HELPERS
// ================================

const authenticate = verifyToken;

const authenticateOptional = optionalAuth;

const requireAuth = [verifyToken];

const requireVerifiedAuth = [verifyToken, requireEmailVerification];

const requireVerifiedVendor = [
  verifyToken, 
  requireEmailVerification, 
  requireVendorVerification
];

// ================================
// TOKEN BLACKLIST (FOR LOGOUT)
// ================================

// In a production environment, you might want to use Redis for this
const tokenBlacklist = new Set();

const addToBlacklist = (token) => {
  tokenBlacklist.add(token);
  
  // Clean up expired tokens periodically
  // In production, this should be handled by Redis TTL
  setTimeout(() => {
    tokenBlacklist.delete(token);
  }, 15 * 60 * 1000); // 15 minutes (access token expiry)
};

const isBlacklisted = (token) => {
  return tokenBlacklist.has(token);
};

const checkBlacklist = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    
    if (isBlacklisted(token)) {
      return res.status(401).json({
        success: false,
        error: 'Token invalidated',
        code: ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'Please login again'
      });
    }
  }
  
  next();
};

module.exports = {
  // Core middleware
  verifyToken,
  optionalAuth,
  requireEmailVerification,
  requireVendorVerification,
  requireOwnership,
  authRateLimit,
  checkBlacklist,
  
  // Composed middleware
  authenticate,
  authenticateOptional,
  requireAuth,
  requireVerifiedAuth,
  requireVerifiedVendor,
  
  // Utility functions
  validateTokenFormat,
  addToBlacklist,
  isBlacklisted
};