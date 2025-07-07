// apps/backend/src/middleware/roleMiddleware.js
// Role-Based Access Control (RBAC) middleware for VOID Marketplace

const { USER_ROLES, ROLE_PERMISSIONS, ERROR_CODES } = require('../config/constants');
const logger = require('../utils/logger');

// ================================
// ROLE HIERARCHY DEFINITIONS
// ================================

const ROLE_HIERARCHY = {
  [USER_ROLES.SUPER_ADMIN]: 5,
  [USER_ROLES.ADMIN]: 4,
  [USER_ROLES.MODERATOR]: 3,
  [USER_ROLES.VENDOR]: 2,
  [USER_ROLES.USER]: 1
};

// ================================
// PERMISSION CHECKING FUNCTIONS
// ================================

/**
 * Check if a role has a specific permission
 * @param {string} role - User role
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
const hasPermission = (role, permission) => {
  const rolePermissions = ROLE_PERMISSIONS[role] || [];
  return rolePermissions.includes(permission);
};

/**
 * Check if a role has any of the specified permissions
 * @param {string} role - User role
 * @param {string[]} permissions - Array of permissions to check
 * @returns {boolean}
 */
const hasAnyPermission = (role, permissions) => {
  return permissions.some(permission => hasPermission(role, permission));
};

/**
 * Check if a role has all of the specified permissions
 * @param {string} role - User role
 * @param {string[]} permissions - Array of permissions to check
 * @returns {boolean}
 */
const hasAllPermissions = (role, permissions) => {
  return permissions.every(permission => hasPermission(role, permission));
};

/**
 * Check if a role has higher or equal hierarchy level than another role
 * @param {string} userRole - User's role
 * @param {string} requiredRole - Required minimum role
 * @returns {boolean}
 */
const hasRoleLevel = (userRole, requiredRole) => {
  const userLevel = ROLE_HIERARCHY[userRole] || 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
  return userLevel >= requiredLevel;
};

// ================================
// MIDDLEWARE FUNCTIONS
// ================================

/**
 * Require specific role(s)
 * @param {string|string[]} roles - Required role(s)
 * @returns {Function}
 */
const requireRole = (roles) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'Please login to access this resource'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(`Access denied: User ${req.user.id} (${req.user.role}) tried to access ${req.path} requiring roles: ${allowedRoles.join(', ')}`);
      
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
        message: 'You do not have the required role to access this resource'
      });
    }

    next();
  };
};

/**
 * Require minimum role level
 * @param {string} minRole - Minimum required role
 * @returns {Function}
 */
const requireMinRole = (minRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'Please login to access this resource'
      });
    }

    if (!hasRoleLevel(req.user.role, minRole)) {
      logger.warn(`Access denied: User ${req.user.id} (${req.user.role}) tried to access ${req.path} requiring minimum role: ${minRole}`);
      
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
        message: 'You do not have sufficient privileges to access this resource'
      });
    }

    next();
  };
};

/**
 * Require specific permission(s)
 * @param {string|string[]} permissions - Required permission(s)
 * @param {boolean} requireAll - Whether to require all permissions (default: false, requires any)
 * @returns {Function}
 */
const requirePermission = (permissions, requireAll = false) => {
  const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'Please login to access this resource'
      });
    }

    const userRole = req.user.role;
    const hasRequiredPermissions = requireAll 
      ? hasAllPermissions(userRole, requiredPermissions)
      : hasAnyPermission(userRole, requiredPermissions);

    if (!hasRequiredPermissions) {
      logger.warn(`Access denied: User ${req.user.id} (${userRole}) tried to access ${req.path} requiring permissions: ${requiredPermissions.join(', ')}`);
      
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
        message: 'You do not have the required permissions to access this resource'
      });
    }

    next();
  };
};

/**
 * Check if user is admin (Admin or Super Admin)
 * @returns {Function}
 */
const requireAdmin = () => {
  return requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN]);
};

/**
 * Check if user is super admin
 * @returns {Function}
 */
const requireSuperAdmin = () => {
  return requireRole(USER_ROLES.SUPER_ADMIN);
};

/**
 * Check if user is vendor
 * @returns {Function}
 */
const requireVendor = () => {
  return requireRole(USER_ROLES.VENDOR);
};

/**
 * Check if user is moderator or higher
 * @returns {Function}
 */
const requireModerator = () => {
  return requireMinRole(USER_ROLES.MODERATOR);
};

/**
 * Allow resource owner or admin access
 * @param {string} resourceParam - Parameter name containing resource ID
 * @param {string} ownerField - Field name in resource that contains owner ID
 * @param {string} modelName - Prisma model name to check ownership
 * @returns {Function}
 */
const requireOwnerOrAdmin = (resourceParam = 'id', ownerField = 'user_id', modelName = null) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'Please login to access this resource'
      });
    }

    // Admins can access everything
    if (hasRoleLevel(req.user.role, USER_ROLES.ADMIN)) {
      return next();
    }

    const resourceId = req.params[resourceParam];
    const userId = req.user.id;

    // If no model specified, assume direct ID comparison
    if (!modelName) {
      if (resourceId === userId) {
        return next();
      }
    } else {
      // Check ownership in database
      try {
        const { prisma } = require('../config/db');
        const resource = await prisma[modelName].findUnique({
          where: { id: resourceId },
          select: { [ownerField]: true }
        });

        if (resource && resource[ownerField] === userId) {
          return next();
        }
      } catch (error) {
        logger.error(`Error checking ownership for ${modelName}:`, error);
        return res.status(500).json({
          success: false,
          error: 'Server error',
          message: 'Error checking resource ownership'
        });
      }
    }

    return res.status(403).json({
      success: false,
      error: 'Access denied',
      code: ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
      message: 'You can only access your own resources'
    });
  };
};

/**
 * Conditional access based on user role and resource ownership
 * @param {Object} conditions - Access conditions for different scenarios
 * @returns {Function}
 */
const conditionalAccess = (conditions = {}) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'Please login to access this resource'
      });
    }

    const userRole = req.user.role;
    
    // Check role-based conditions
    if (conditions[userRole]) {
      const condition = conditions[userRole];
      
      if (typeof condition === 'function') {
        try {
          const allowed = await condition(req);
          if (!allowed) {
            return res.status(403).json({
              success: false,
              error: 'Access denied',
              code: ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
              message: 'Access not allowed for this resource'
            });
          }
        } catch (error) {
          logger.error('Error in conditional access check:', error);
          return res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'Error checking access conditions'
          });
        }
      } else if (!condition) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          code: ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
          message: 'Access not allowed for your role'
        });
      }
    }

    next();
  };
};

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Get user permissions based on role
 * @param {string} role - User role
 * @returns {string[]}
 */
const getUserPermissions = (role) => {
  return ROLE_PERMISSIONS[role] || [];
};

/**
 * Check if user can perform action on resource
 * @param {Object} user - User object
 * @param {string} action - Action to perform
 * @param {Object} resource - Resource object (optional)
 * @returns {boolean}
 */
const canPerformAction = (user, action, resource = null) => {
  // Check basic permission
  if (!hasPermission(user.role, action)) {
    return false;
  }

  // Additional checks based on resource ownership
  if (resource && resource.user_id && resource.user_id !== user.id) {
    // Check if user has admin privileges for others' resources
    return hasRoleLevel(user.role, USER_ROLES.ADMIN);
  }

  return true;
};

module.exports = {
  // Core middleware functions
  requireRole,
  requireMinRole,
  requirePermission,
  requireAdmin,
  requireSuperAdmin,
  requireVendor,
  requireModerator,
  requireOwnerOrAdmin,
  conditionalAccess,
  
  // Utility functions
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  hasRoleLevel,
  getUserPermissions,
  canPerformAction,
  
  // Constants
  ROLE_HIERARCHY
};