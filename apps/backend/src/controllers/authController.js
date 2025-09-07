// apps/backend/src/controllers/authController.js
// Authentication controller for VOID Marketplace

const authService = require('../services/authService');
const { asyncHandler } = require('../middleware/errorMiddleware');
const { addToBlacklist } = require('../middleware/authMiddleware');
const { extractTokenFromHeader, getTokenExpiration } = require('../utils/tokenUtils');
const logger = require('../utils/logger');

// ================================
// USER REGISTRATION
// ================================

/**
 * @desc    Register new user
 * @route   POST /api/v1/auth/register
 * @access  Public
 */
const register = asyncHandler(async (req, res) => {
  const { email, username, password, first_name, last_name, phone, role, business_name, business_address, tax_id } = req.body;

  // Register user
  const result = await authService.registerUser({
    email,
    username,
    password,
    first_name,
    last_name,
    phone,
    role,
    business_name,
    business_address,
    tax_id
  });

  // Set refresh token as httpOnly cookie
  res.cookie('refreshToken', result.tokens.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
      tokenType: result.tokens.tokenType,
      emailVerificationRequired: !result.user.is_verified
    }
  });

  // Log the event
  logger.info('User registration successful', {
    userId: result.user.id,
    email: result.user.email,
    role: result.user.role,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
});

/**
 * @desc    User login
 * @route   POST /api/v1/auth/login
 * @access  Public
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const userAgent = req.get('User-Agent');
  const ipAddress = req.ip;

  // Authenticate user
  const result = await authService.loginUser(email, password, userAgent, ipAddress);

  // Set refresh token as httpOnly cookie
  res.cookie('refreshToken', result.tokens.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
      tokenType: result.tokens.tokenType
    }
  });
});

/**
 * @desc    User logout
 * @route   POST /api/v1/auth/logout
 * @access  Private
 */
const logout = asyncHandler(async (req, res) => {
  // Get access token from header
  const accessToken = extractTokenFromHeader(req.headers.authorization);
  const refreshToken = req.cookies.refreshToken;

  // Add tokens to blacklist if they exist
  if (accessToken) {
    const expiration = getTokenExpiration(accessToken);
    if (expiration) {
      addToBlacklist(accessToken);
    }
  }

  if (refreshToken) {
    const expiration = getTokenExpiration(refreshToken);
    if (expiration) {
      addToBlacklist(refreshToken);
    }
  }

  // Clear refresh token cookie
  res.clearCookie('refreshToken');

  res.json({
    success: true,
    message: 'Logout successful'
  });

  // Log the event
  logger.info('User logout', {
    userId: req.user?.id,
    ip: req.ip
  });
});

// ================================
// TOKEN MANAGEMENT
// ================================

/**
 * @desc    Refresh access token
 * @route   POST /api/v1/auth/refresh
 * @access  Public
 */
const refreshToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      error: 'Refresh token not provided',
      message: 'Please login again'
    });
  }

  // Refresh tokens
  const result = await authService.refreshAccessToken(refreshToken);

  // Set new refresh token as httpOnly cookie
  res.cookie('refreshToken', result.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  res.json({
    success: true,
    message: 'Token refreshed successfully',
    data: {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      tokenType: result.tokenType
    }
  });
});

// ================================
// EMAIL VERIFICATION
// ================================

/**
 * @desc    Verify email address
 * @route   POST /api/v1/auth/verify-email
 * @access  Public
 */
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;

  // Verify email
  const user = await authService.verifyEmail(token);

  res.json({
    success: true,
    message: 'Email verified successfully',
    data: { user }
  });
});

/**
 * @desc    Resend email verification
 * @route   POST /api/v1/auth/resend-verification
 * @access  Private
 */
const resendEmailVerification = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Resend verification email
  const verificationToken = await authService.resendEmailVerification(userId);

  res.json({
    success: true,
    message: 'Verification email sent successfully',
    data: {
      verificationRequired: true
    }
  });

  // In a real application, you would send an email here
  logger.info('Email verification resent', {
    userId,
    verificationToken // This would be sent via email, not logged
  });
});

// ================================
// PASSWORD MANAGEMENT
// ================================

/**
 * @desc    Change password
 * @route   PUT /api/v1/auth/password
 * @access  Private
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  // Change password
  await authService.changePassword(userId, currentPassword, newPassword);

  res.json({
    success: true,
    message: 'Password changed successfully'
  });
});

/**
 * @desc    Request password reset
 * @route   POST /api/v1/auth/forgot-password
 * @access  Public
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  // Request password reset
  const resetToken = await authService.requestPasswordReset(email);

  // Always return success to prevent email enumeration
  res.json({
    success: true,
    message: 'If an account with that email exists, a password reset link has been sent'
  });

  // In a real application, you would send an email here
  if (resetToken) {
    logger.info('Password reset requested', {
      email,
      resetToken // This would be sent via email, not logged
    });
  }
});

/**
 * @desc    Reset password
 * @route   POST /api/v1/auth/reset-password
 * @access  Public
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  // Reset password
  await authService.resetPassword(token, newPassword);

  res.json({
    success: true,
    message: 'Password reset successfully'
  });
});

// ================================
// PROFILE MANAGEMENT
// ================================

/**
 * @desc    Get user profile
 * @route   GET /api/v1/auth/profile
 * @access  Private
 */
const getProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Get user profile
  const user = await authService.getUserProfile(userId);

  res.json({
    success: true,
    data: { user }
  });
});

/**
 * @desc    Update user profile
 * @route   PATCH /api/v1/auth/profile
 * @access  Private
 */
const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const updateData = req.body;

  // Update user profile
  const updatedUser = await authService.updateUserProfile(userId, updateData);

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: { user: updatedUser }
  });
});

/**
 * @desc    Upload profile avatar
 * @route   POST /api/v1/auth/avatar
 * @access  Private
 */
const uploadAvatar = asyncHandler(async (req, res) => {
  // This will be handled by upload middleware
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No file uploaded',
      message: 'Please select an image file'
    });
  }

  const userId = req.user.id;
  const avatarUrl = `/uploads/avatars/${req.file.filename}`;

  // Update user avatar URL in database
  const { dbRouter, QueryOptimizer } = require('../config/db');
  const updatedUser = await dbRouter.user.update({
    where: { id: userId },
    data: { 
      avatar_url: avatarUrl,
      updated_at: new Date()
    },
    select: {
      id: true,
      email: true,
      username: true,
      first_name: true,
      last_name: true,
      avatar_url: true,
      role: true
    }
  });

  res.json({
    success: true,
    message: 'Avatar uploaded successfully',
    data: { 
      user: updatedUser,
      avatarUrl 
    }
  });
});

// ================================
// ACCOUNT MANAGEMENT
// ================================

/**
 * @desc    Deactivate account
 * @route   POST /api/v1/auth/deactivate
 * @access  Private
 */
const deactivateAccount = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { reason } = req.body;

  // Deactivate account
  await authService.deactivateAccount(userId, reason);

  // Clear cookies
  res.clearCookie('refreshToken');

  res.json({
    success: true,
    message: 'Account deactivated successfully'
  });
});

/**
 * @desc    Get account status
 * @route   GET /api/v1/auth/status
 * @access  Private
 */
const getAccountStatus = asyncHandler(async (req, res) => {
  const user = req.user;

  res.json({
    success: true,
    data: {
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      isVerified: user.is_verified,
      isVendorVerified: user.vendor_verified,
      accountHealth: {
        emailVerified: user.is_verified,
        profileComplete: !!(user.first_name && user.last_name),
        vendorVerified: user.role !== 'VENDOR' || user.vendor_verified
      }
    }
  });
});

// ================================
// VENDOR VERIFICATION
// ================================

/**
 * @desc    Request vendor verification
 * @route   POST /api/v1/auth/verify-vendor
 * @access  Private (Vendor role)
 */
const requestVendorVerification = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { business_name, business_address, tax_id, documents } = req.body;

  // Update vendor information
  const { dbRouter, QueryOptimizer } = require('../config/db');
  const updatedUser = await dbRouter.user.update({
    where: { id: userId },
    data: {
      business_name,
      business_address,
      tax_id,
      updated_at: new Date()
    },
    select: {
      id: true,
      email: true,
      business_name: true,
      business_address: true,
      vendor_verified: true
    }
  });

  // In a real application, this would trigger an admin review process
  
  res.json({
    success: true,
    message: 'Vendor verification request submitted successfully',
    data: {
      user: updatedUser,
      status: 'pending_review'
    }
  });

  logger.info('Vendor verification requested', {
    userId,
    business_name
  });
});

module.exports = {
  register,
  login,
  logout,
  refreshToken,
  verifyEmail,
  resendEmailVerification,
  changePassword,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  uploadAvatar,
  deactivateAccount,
  getAccountStatus,
  requestVendorVerification
};