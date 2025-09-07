// apps/backend/src/routes/authRoutes.js
// Authentication routes for VOID Marketplace

const express = require('express');
const authController = require('../controllers/authController');
const authValidator = require('../validators/authValidator');
const { 
  authenticate, 
  requireAuth, 
  requireVerifiedAuth,
  authRateLimit,
  checkBlacklist 
} = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { uploadAvatar, handleUploadError } = require('../middleware/uploadMiddleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

// Apply rate limiting to auth routes
router.use(authRateLimit);

// Apply token blacklist check to protected routes
router.use(checkBlacklist);

// ================================
// PUBLIC ROUTES (No Authentication)
// ================================

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register new user account
 * @access  Public
 */
router.post('/register',
  authValidator.validateRegister,
  authController.register
);

/**
 * @route   POST /api/v1/auth/login
 * @desc    User login
 * @access  Public
 */
router.post('/login',
  authValidator.validateLogin,
  authController.login
);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public
 */
router.post('/refresh',
  authValidator.validateRefreshToken,
  authController.refreshToken
);

/**
 * @route   POST /api/v1/auth/verify-email
 * @desc    Verify email address using token
 * @access  Public
 */
router.post('/verify-email',
  authValidator.validateVerifyEmail,
  authController.verifyEmail
);

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Request password reset
 * @access  Public
 */
router.post('/forgot-password',
  authValidator.validateForgotPassword,
  authController.forgotPassword
);

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password using token
 * @access  Public
 */
router.post('/reset-password',
  authValidator.validateResetPassword,
  authController.resetPassword
);

// ================================
// AUTHENTICATED ROUTES
// ================================

/**
 * @route   POST /api/v1/auth/logout
 * @desc    User logout (invalidate tokens)
 * @access  Private
 */
router.post('/logout',
  authenticate,
  authController.logout
);

/**
 * @route   GET /api/v1/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile',
  authenticate,
  authController.getProfile
);

/**
 * @route   PATCH /api/v1/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.patch('/profile',
  authenticate,
  authValidator.validateUpdateProfile,
  authController.updateProfile
);

/**
 * @route   POST /api/v1/auth/avatar
 * @desc    Upload user avatar
 * @access  Private
 */
router.post('/avatar',
  authenticate,
  uploadAvatar,
  handleUploadError,
  authValidator.validateAvatarUpload,
  authController.uploadAvatar
);

/**
 * @route   PUT /api/v1/auth/password
 * @desc    Change password
 * @access  Private
 */
router.put('/password',
  authenticate,
  authValidator.validateChangePassword,
  authController.changePassword
);

/**
 * @route   POST /api/v1/auth/resend-verification
 * @desc    Resend email verification
 * @access  Private
 */
router.post('/resend-verification',
  authenticate,
  authController.resendEmailVerification
);

/**
 * @route   GET /api/v1/auth/status
 * @desc    Get account status and health
 * @access  Private
 */
router.get('/status',
  authenticate,
  authController.getAccountStatus
);

/**
 * @route   POST /api/v1/auth/deactivate
 * @desc    Deactivate user account
 * @access  Private
 */
router.post('/deactivate',
  authenticate,
  authValidator.validateDeactivateAccount,
  authController.deactivateAccount
);

// ================================
// VENDOR-SPECIFIC ROUTES
// ================================

/**
 * @route   POST /api/v1/auth/verify-vendor
 * @desc    Request vendor verification
 * @access  Private (Vendor role only)
 */
router.post('/verify-vendor',
  authenticate,
  requireRole(USER_ROLES.VENDOR),
  authValidator.validateVendorVerification,
  authController.requestVendorVerification
);

// ================================
// ADMIN ROUTES (Future)
// ================================

/**
 * @route   GET /api/v1/auth/admin/users
 * @desc    Get all users (admin only)
 * @access  Private (Admin+)
 */
router.get('/admin/users',
  authenticate,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN]),
  async (req, res) => {
    // This will be implemented when admin system is built
    res.status(501).json({
      success: false,
      error: 'Not implemented',
      message: 'Admin user management will be available in the admin dashboard'
    });
  }
);

/**
 * @route   PATCH /api/v1/auth/admin/users/:id/verify-vendor
 * @desc    Approve vendor verification (admin only)
 * @access  Private (Admin+)
 */
router.patch('/admin/users/:id/verify-vendor',
  authenticate,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN]),
  async (req, res) => {
    try {
      const { prisma } = require('../config/db-original');
      const logger = require('../utils/logger');
      const { id: userId } = req.params;
      const { approved, reason } = req.body;

      // Update vendor verification status
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { 
          vendor_verified: Boolean(approved),
          updated_at: new Date()
        },
        select: {
          id: true,
          email: true,
          username: true,
          business_name: true,
          vendor_verified: true
        }
      });

      // Create admin action record
      await prisma.adminAction.create({
        data: {
          admin_id: req.user.id,
          action_type: approved ? 'approve_vendor' : 'reject_vendor',
          target_type: 'user',
          target_id: userId,
          reason,
          metadata: JSON.stringify({
            approved,
            business_name: updatedUser.business_name
          })
        }
      });

      logger.info('Vendor verification status updated', {
        adminId: req.user.id,
        userId,
        approved,
        reason
      });

      res.json({
        success: true,
        message: `Vendor verification ${approved ? 'approved' : 'rejected'}`,
        data: { user: updatedUser }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Vendor verification update failed',
        message: error.message
      });
    }
  }
);

// ================================
// FUTURE 2FA ROUTES (Placeholder)
// ================================

/**
 * @route   POST /api/v1/auth/2fa/enable
 * @desc    Enable two-factor authentication
 * @access  Private
 */
router.post('/2fa/enable',
  authenticate,
  authValidator.validateEnable2FA,
  (req, res) => {
    res.status(501).json({
      success: false,
      error: 'Feature not implemented',
      message: '2FA will be available in a future update'
    });
  }
);

/**
 * @route   POST /api/v1/auth/2fa/verify
 * @desc    Verify 2FA code
 * @access  Private
 */
router.post('/2fa/verify',
  authenticate,
  authValidator.validateVerify2FA,
  (req, res) => {
    res.status(501).json({
      success: false,
      error: 'Feature not implemented',
      message: '2FA will be available in a future update'
    });
  }
);

// ================================
// DEV/TEST ROUTES (Development Only)
// ================================

if (process.env.NODE_ENV === 'development') {
  /**
   * @route   GET /api/v1/auth/dev/test-accounts
   * @desc    Get test account credentials (dev only)
   * @access  Public (Development only)
   */
  router.get('/dev/test-accounts', (req, res) => {
    res.json({
      success: true,
      message: 'Test accounts for development',
      data: {
        accounts: [
          {
            role: 'SUPER_ADMIN',
            email: 'admin@void-marketplace.com',
            password: 'Password123!',
            description: 'Super admin with full system access'
          },
          {
            role: 'ADMIN',
            email: 'admin.user@void-marketplace.com', 
            password: 'Password123!',
            description: 'Regular admin for management tasks'
          },
          {
            role: 'VENDOR',
            email: 'tech.vendor@void-marketplace.com',
            password: 'Password123!',
            description: 'Verified vendor with sample listings'
          },
          {
            role: 'VENDOR',
            email: 'fashion.vendor@void-marketplace.com',
            password: 'Password123!',
            description: 'Fashion vendor with premium listings'
          },
          {
            role: 'USER',
            email: 'buyer1@void-marketplace.com',
            password: 'Password123!',
            description: 'Regular buyer with purchase history'
          },
          {
            role: 'USER',
            email: 'buyer2@void-marketplace.com',
            password: 'Password123!',
            description: 'Another buyer for testing'
          }
        ],
        note: 'These accounts are automatically created by the database seed script'
      }
    });
  });

  /**
   * @route   POST /api/v1/auth/dev/create-test-user
   * @desc    Create a test user quickly (dev only)
   * @access  Public (Development only)
   */
  router.post('/dev/create-test-user', async (req, res) => {
    try {
      const { email, username, role = 'USER' } = req.body;
      const bcrypt = require('bcryptjs');
      const { prisma } = require('../config/db-original');

      const hashedPassword = await bcrypt.hash('TestPassword123!', 12);

      const user = await prisma.user.create({
        data: {
          email,
          username,
          password_hash: hashedPassword,
          first_name: 'Test',
          last_name: 'User',
          role,
          status: 'ACTIVE',
          is_verified: true,
          vendor_verified: role === 'VENDOR'
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true
        }
      });

      res.status(201).json({
        success: true,
        message: 'Test user created',
        data: { 
          user,
          password: 'TestPassword123!'
        }
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        error: 'Failed to create test user',
        message: error.message
      });
    }
  });
}

// ================================
// ROUTE DOCUMENTATION
// ================================

/**
 * @route   GET /api/v1/auth
 * @desc    Get authentication API documentation
 * @access  Public
 */
router.get('/', (req, res) => {
  res.json({
    name: 'VOID Marketplace Authentication API',
    version: '1.0.0',
    description: 'Complete authentication system with JWT tokens, email verification, and role-based access',
    endpoints: {
      public: {
        'POST /register': 'Register new user account',
        'POST /login': 'User login with email/username',
        'POST /refresh': 'Refresh access token',
        'POST /verify-email': 'Verify email with token',
        'POST /forgot-password': 'Request password reset',
        'POST /reset-password': 'Reset password with token'
      },
      authenticated: {
        'POST /logout': 'Logout and invalidate tokens',
        'GET /profile': 'Get user profile',
        'PATCH /profile': 'Update user profile',
        'POST /avatar': 'Upload profile avatar',
        'PUT /password': 'Change password',
        'POST /resend-verification': 'Resend email verification',
        'GET /status': 'Get account status',
        'POST /deactivate': 'Deactivate account'
      },
      vendor: {
        'POST /verify-vendor': 'Request vendor verification'
      },
      admin: {
        'GET /admin/users': 'Get all users (coming soon)',
        'PATCH /admin/users/:id/verify-vendor': 'Approve vendor verification'
      },
      development: {
        'GET /dev/test-accounts': 'Get test account list (dev only)',
        'POST /dev/create-test-user': 'Create test user (dev only)'
      }
    },
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer <access_token>',
      refresh: 'Use refresh token to get new access token',
      expiry: {
        access_token: '15 minutes',
        refresh_token: '7 days'
      }
    },
    roles: {
      USER: 'Regular marketplace user',
      VENDOR: 'Product seller with listing permissions',
      MODERATOR: 'Content moderation permissions',
      ADMIN: 'Administrative permissions',
      SUPER_ADMIN: 'Full system access'
    }
  });
});

module.exports = router;