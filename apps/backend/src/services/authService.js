// apps/backend/src/services/authService.js
// Complete Authentication service layer for VOID Marketplace

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { prisma } = require('../config/db');
const { USER_ROLES, USER_STATUS, ERROR_CODES } = require('../config/constants');
const { generateTokenPair, generateEmailVerificationToken, generatePasswordResetToken, verifyPasswordResetToken } = require('../utils/tokenUtils');
const logger = require('../utils/logger');

// ================================
// CUSTOM ERROR CLASSES
// ================================

class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

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
    // Validate required fields
    if (!email || !username || !password || !first_name || !last_name) {
      throw new ValidationError('Missing required fields: email, username, password, first_name, last_name');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ValidationError('Invalid email format');
    }

    // Validate password strength
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

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
    if (!identifier || !password) {
      throw new ValidationError('Email/username and password are required');
    }

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

    // Check if account is active
    if (user.status === USER_STATUS.BANNED || user.status === USER_STATUS.SUSPENDED) {
      throw new AuthenticationError('Account is suspended or banned');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new AuthenticationError('Invalid credentials');
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

    logger.info('User login successful', {
      userId: user.id,
      email: user.email,
      ipAddress,
      userAgent: userAgent?.substring(0, 100)
    });

    return {
      user: userWithoutPassword,
      tokens
    };
  } catch (error) {
    logger.error('User login failed:', error);
    throw error;
  }
};

// ================================
// TOKEN MANAGEMENT
// ================================

/**
 * Refresh access token
 * @param {string} refreshToken - Refresh token
 * @returns {Object} New tokens
 */
const refreshAccessToken = async (refreshToken) => {
  try {
    if (!refreshToken) {
      throw new AuthenticationError('Refresh token is required');
    }

    // Verify refresh token (implement in tokenUtils)
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    // Get user
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

    if (user.status !== USER_STATUS.ACTIVE) {
      throw new AuthenticationError('User account is not active');
    }

    // Generate new tokens
    const tokens = generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    logger.info('Token refreshed successfully', { userId: user.id });

    return tokens;
  } catch (error) {
    logger.error('Token refresh failed:', error);
    throw new AuthenticationError('Invalid or expired refresh token');
  }
};

// ================================
// EMAIL VERIFICATION
// ================================

/**
 * Verify email address
 * @param {string} token - Email verification token
 * @returns {Object} Updated user data
 */
const verifyEmail = async (token) => {
  try {
    if (!token) {
      throw new ValidationError('Verification token is required');
    }

    // Verify token format and extract data
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.type !== 'email_verification') {
      throw new ValidationError('Invalid token type');
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.is_verified) {
      throw new ValidationError('Email is already verified');
    }

    // Update user status
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
// PASSWORD MANAGEMENT
// ================================

/**
 * Request password reset
 * @param {string} email - User email
 * @returns {string|null} Reset token or null if user not found
 */
const requestPasswordReset = async (email) => {
  try {
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      // Don't reveal if user exists for security
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
 * Reset password with token
 * @param {string} token - Reset token
 * @param {string} newPassword - New password
 * @returns {Object} Success result
 */
const resetPassword = async (token, newPassword) => {
  try {
    if (!token || !newPassword) {
      throw new ValidationError('Reset token and new password are required');
    }

    // Validate password strength
    if (newPassword.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    // Verify reset token
    const isValidToken = verifyPasswordResetToken(token);
    if (!isValidToken) {
      throw new ValidationError('Invalid or expired reset token');
    }

    // Extract user ID from token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      throw new NotFoundError('User not found');
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
    return { success: true };
  } catch (error) {
    logger.error('Password reset failed:', error);
    throw error;
  }
};

/**
 * Change password for authenticated user
 * @param {string} userId - User ID
 * @param {string} currentPassword - Current password
 * @param {string} newPassword - New password
 * @returns {Object} Success result
 */
const changePassword = async (userId, currentPassword, newPassword) => {
  try {
    if (!currentPassword || !newPassword) {
      throw new ValidationError('Current password and new password are required');
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      throw new ValidationError('New password must be at least 8 characters long');
    }

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
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: {
        password_hash: hashedPassword,
        updated_at: new Date()
      }
    });

    logger.info('Password changed successfully', { userId });
    return { success: true };
  } catch (error) {
    logger.error('Password change failed:', error);
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
        updated_at: true,
        last_login: true
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
    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        filteredData[key] = updateData[key];
      }
    });

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

    logger.info('User profile updated', { userId });
    return updatedUser;
  } catch (error) {
    logger.error('Update user profile failed:', error);
    throw error;
  }
};

/**
 * Update user avatar
 * @param {string} userId - User ID
 * @param {string} avatarUrl - Avatar URL
 * @returns {Object} Updated user data
 */
const updateUserAvatar = async (userId, avatarUrl) => {
  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        avatar_url: avatarUrl,
        updated_at: new Date()
      },
      select: {
        id: true,
        avatar_url: true,
        updated_at: true
      }
    });

    logger.info('User avatar updated', { userId, avatarUrl });
    return updatedUser;
  } catch (error) {
    logger.error('Update user avatar failed:', error);
    throw error;
  }
};

// ================================
// VENDOR MANAGEMENT
// ================================

/**
 * Request vendor verification
 * @param {string} userId - User ID
 * @param {Object} verificationData - Verification documents and data
 * @returns {Object} Verification request result
 */
const requestVendorVerification = async (userId, verificationData) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.role !== USER_ROLES.VENDOR) {
      throw new ValidationError('Only vendors can request verification');
    }

    if (user.vendor_verified) {
      throw new ValidationError('Vendor is already verified');
    }

    // Update user with verification request
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        status: USER_STATUS.PENDING_VERIFICATION,
        updated_at: new Date()
      }
    });

    logger.info('Vendor verification requested', { userId });
    return { success: true, status: 'pending' };
  } catch (error) {
    logger.error('Vendor verification request failed:', error);
    throw error;
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // User management
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile,
  updateUserAvatar,

  // Token management
  refreshAccessToken,

  // Email verification
  verifyEmail,
  resendEmailVerification,

  // Password management
  requestPasswordReset,
  resetPassword,
  changePassword,

  // Vendor management
  requestVendorVerification,

  // Error classes for external use
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError
};