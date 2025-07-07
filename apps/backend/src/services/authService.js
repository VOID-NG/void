// apps/backend/src/services/authService.js
// Authentication service layer for VOID Marketplace

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { prisma } = require('../config/db');
const { USER_ROLES, USER_STATUS, ERROR_CODES } = require('../config/constants');
const { generateTokenPair, generateEmailVerificationToken, generatePasswordResetToken } = require('../utils/tokenUtils');
const { AuthenticationError, ConflictError, NotFoundError, ValidationError } = require('../middleware/errorMiddleware');
const logger = require('../utils/logger');

// ================================
// USER REGISTRATION
// ================================

/**
 * Register a new user
 * @param {Object} userData - User registration data
 * @returns {Object} User data and tokens
 */
const registerUser = async (userData) => {
  const {
    email,
    username,
    password,
    first_name,
    last_name,
    phone,
    role = USER_ROLES.USER,
    business_name,
    business_address,
    tax_id
  } = userData;

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: email.toLowerCase() },
          { username: username.toLowerCase() }
        ]
      }
    });

    if (existingUser) {
      const field = existingUser.email === email.toLowerCase() ? 'email' : 'username';
      throw new ConflictError(`User with this ${field} already exists`);
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        username: username.toLowerCase(),
        password_hash: hashedPassword,
        first_name,
        last_name,
        phone,
        role,
        status: USER_STATUS.PENDING_VERIFICATION,
        business_name: role === USER_ROLES.VENDOR ? business_name : null,
        business_address: role === USER_ROLES.VENDOR ? business_address : null,
        tax_id: role === USER_ROLES.VENDOR ? tax_id : null
      },
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

    // Generate tokens
    const tokens = generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    // Generate email verification token
    const emailVerificationToken = generateEmailVerificationToken(user.id, user.email);

    // Log registration
    logger.info('User registered successfully', {
      userId: user.id,
      email: user.email,
      role: user.role
    });

    return {
      user,
      tokens,
      emailVerificationToken
    };
  } catch (error) {
    logger.error('User registration failed:', error);
    throw error;
  }
};

// ================================
// USER LOGIN
// ================================

/**
 * Authenticate user login
 * @param {string} identifier - Email or username
 * @param {string} password - User password
 * @param {string} userAgent - User agent string
 * @param {string} ipAddress - IP address
 * @returns {Object} User data and tokens
 */
const loginUser = async (identifier, password, userAgent, ipAddress) => {
  try {
    // Find user by email or username
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier.toLowerCase() },
          { username: identifier.toLowerCase() }
        ]
      }
    });

    if (!user) {
      throw new AuthenticationError('Invalid credentials');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new AuthenticationError('Invalid credentials');
    }

    // Check user status
    if (user.status === USER_STATUS.BANNED) {
      throw new AuthenticationError('Account has been permanently banned');
    }

    if (user.status === USER_STATUS.SUSPENDED) {
      throw new AuthenticationError('Account is temporarily suspended');
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { last_login: new Date() }
    });

    // Generate tokens
    const tokens = generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    // Remove sensitive data
    const { password_hash, ...userWithoutPassword } = user;

    // Log successful login
    logger.info('User logged in successfully', {
      userId: user.id,
      email: user.email,
      userAgent,
      ipAddress
    });

    return {
      user: userWithoutPassword,
      tokens
    };
  } catch (error) {
    logger.error('User login failed:', {
      identifier,
      error: error.message,
      userAgent,
      ipAddress
    });
    throw error;
  }
};

// ================================
// PASSWORD MANAGEMENT
// ================================

/**
 * Change user password
 * @param {string} userId - User ID
 * @param {string} currentPassword - Current password
 * @param {string} newPassword - New password
 * @returns {boolean} Success status
 */
const changePassword = async (userId, currentPassword, newPassword) => {
  try {
    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isCurrentPasswordValid) {
      throw new AuthenticationError('Current password is incorrect');
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { 
        password_hash: hashedNewPassword,
        updated_at: new Date()
      }
    });

    logger.info('Password changed successfully', { userId });
    return true;
  } catch (error) {
    logger.error('Password change failed:', error);
    throw error;
  }
};

/**
 * Request password reset
 * @param {string} email - User email
 * @returns {string} Password reset token
 */
const requestPasswordReset = async (email) => {
  try {
    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      // Don't reveal if email exists
      logger.warn('Password reset requested for non-existent email', { email });
      return null;
    }

    // Generate reset token
    const resetToken = generatePasswordResetToken(user.id, user.email);

    logger.info('Password reset requested', { userId: user.id, email });
    return resetToken;
  } catch (error) {
    logger.error('Password reset request failed:', error);
    throw error;
  }
};

/**
 * Reset password using token
 * @param {string} resetToken - Password reset token
 * @param {string} newPassword - New password
 * @returns {boolean} Success status
 */
const resetPassword = async (resetToken, newPassword) => {
  try {
    // Verify reset token (this will throw if invalid/expired)
    const { verifyPasswordResetToken } = require('../utils/tokenUtils');
    const decoded = verifyPasswordResetToken(resetToken);

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user || user.email !== decoded.email) {
      throw new AuthenticationError('Invalid or expired reset token');
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: { 
        password_hash: hashedPassword,
        updated_at: new Date()
      }
    });

    logger.info('Password reset successfully', { userId: user.id });
    return true;
  } catch (error) {
    logger.error('Password reset failed:', error);
    throw error;
  }
};

// ================================
// EMAIL VERIFICATION
// ================================

/**
 * Verify user email
 * @param {string} verificationToken - Email verification token
 * @returns {Object} User data
 */
const verifyEmail = async (verificationToken) => {
  try {
    // Verify token
    const { verifyEmailVerificationToken } = require('../utils/tokenUtils');
    const decoded = verifyEmailVerificationToken(verificationToken);

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user || user.email !== decoded.email) {
      throw new AuthenticationError('Invalid or expired verification token');
    }

    if (user.is_verified) {
      throw new ValidationError('Email is already verified');
    }

    // Update user verification status
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { 
        is_verified: true,
        email_verified_at: new Date(),
        status: user.status === USER_STATUS.PENDING_VERIFICATION ? USER_STATUS.ACTIVE : user.status,
        updated_at: new Date()
      },
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

    logger.info('Email verified successfully', { userId: user.id, email: user.email });
    return updatedUser;
  } catch (error) {
    logger.error('Email verification failed:', error);
    throw error;
  }
};

/**
 * Resend email verification
 * @param {string} userId - User ID
 * @returns {string} New verification token
 */
const resendEmailVerification = async (userId) => {
  try {
    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.is_verified) {
      throw new ValidationError('Email is already verified');
    }

    // Generate new verification token
    const verificationToken = generateEmailVerificationToken(user.id, user.email);

    logger.info('Email verification resent', { userId: user.id });
    return verificationToken;
  } catch (error) {
    logger.error('Resend email verification failed:', error);
    throw error;
  }
};

// ================================
// PROFILE MANAGEMENT
// ================================

/**
 * Get user profile
 * @param {string} userId - User ID
 * @returns {Object} User profile data
 */
const getUserProfile = async (userId) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        first_name: true,
        last_name: true,
        phone: true,
        avatar_url: true,
        bio: true,
        location: true,
        role: true,
        status: true,
        is_verified: true,
        vendor_verified: true,
        business_name: true,
        business_address: true,
        created_at: true,
        last_login: true,
        _count: {
          listings: true,
          reviews_received: true,
          transactions_vendor: true
        }
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  } catch (error) {
    logger.error('Get user profile failed:', error);
    throw error;
  }
};

/**
 * Update user profile
 * @param {string} userId - User ID
 * @param {Object} updateData - Profile update data
 * @returns {Object} Updated user data
 */
const updateUserProfile = async (userId, updateData) => {
  try {
    const allowedFields = [
      'first_name',
      'last_name',
      'phone',
      'bio',
      'location',
      'business_name',
      'business_address'
    ];

    // Filter allowed fields
    const filteredData = {};
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        filteredData[field] = updateData[field];
      }
    }

    if (Object.keys(filteredData).length === 0) {
      throw new ValidationError('No valid fields to update');
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...filteredData,
        updated_at: new Date()
      },
      select: {
        id: true,
        email: true,
        username: true,
        first_name: true,
        last_name: true,
        phone: true,
        avatar_url: true,
        bio: true,
        location: true,
        role: true,
        status: true,
        is_verified: true,
        vendor_verified: true,
        business_name: true,
        business_address: true,
        created_at: true,
        updated_at: true
      }
    });

    logger.info('User profile updated', { userId, updatedFields: Object.keys(filteredData) });
    return updatedUser;
  } catch (error) {
    logger.error('Update user profile failed:', error);
    throw error;
  }
};

// ================================
// TOKEN REFRESH
// ================================

/**
 * Refresh access token
 * @param {string} refreshToken - Refresh token
 * @returns {Object} New tokens
 */
const refreshAccessToken = async (refreshToken) => {
  try {
    const { verifyRefreshToken, refreshAccessToken: generateNewTokens } = require('../utils/tokenUtils');
    
    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Get current user data
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true
      }
    });

    if (!user) {
      throw new AuthenticationError('User not found');
    }

    if (user.status === USER_STATUS.BANNED || user.status === USER_STATUS.SUSPENDED) {
      throw new AuthenticationError('Account is not active');
    }

    // Generate new token pair
    const newTokens = generateNewTokens(refreshToken, {
      userId: user.id,
      email: user.email,
      role: user.role
    });

    logger.info('Access token refreshed', { userId: user.id });
    return newTokens;
  } catch (error) {
    logger.error('Token refresh failed:', error);
    throw error;
  }
};

// ================================
// ACCOUNT DEACTIVATION
// ================================

/**
 * Deactivate user account
 * @param {string} userId - User ID
 * @param {string} reason - Deactivation reason
 * @returns {boolean} Success status
 */
const deactivateAccount = async (userId, reason = 'User requested') => {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        status: USER_STATUS.SUSPENDED,
        updated_at: new Date()
      }
    });

    logger.info('Account deactivated', { userId, reason });
    return true;
  } catch (error) {
    logger.error('Account deactivation failed:', error);
    throw error;
  }
};

module.exports = {
  registerUser,
  loginUser,
  changePassword,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
  resendEmailVerification,
  getUserProfile,
  updateUserProfile,
  refreshAccessToken,
  deactivateAccount
};