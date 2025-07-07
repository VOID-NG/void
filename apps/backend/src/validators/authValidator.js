// apps/backend/src/validators/authValidator.js
// Validation schemas for authentication endpoints

const { Joi, validate, commonSchemas, patterns } = require('../middleware/validateMiddleware');
const { USER_ROLES } = require('../config/constants');

// ================================
// REGISTRATION VALIDATION
// ================================

const registerSchema = {
  body: Joi.object({
    email: commonSchemas.email.required(),
    username: commonSchemas.username.required(),
    password: commonSchemas.password.required(),
    first_name: Joi.string().min(1).max(50).trim().required(),
    last_name: Joi.string().min(1).max(50).trim().required(),
    phone: commonSchemas.phone,
    role: Joi.string().valid(...Object.values(USER_ROLES)).default(USER_ROLES.USER),
    
    // Vendor-specific fields (conditional)
    business_name: Joi.when('role', {
      is: USER_ROLES.VENDOR,
      then: Joi.string().min(2).max(100).trim().required(),
      otherwise: Joi.forbidden()
    }),
    business_address: Joi.when('role', {
      is: USER_ROLES.VENDOR,
      then: Joi.string().min(10).max(200).trim().required(),
      otherwise: Joi.forbidden()
    }),
    tax_id: Joi.when('role', {
      is: USER_ROLES.VENDOR,
      then: Joi.string().min(5).max(50).trim().optional(),
      otherwise: Joi.forbidden()
    }),
    
    // Terms acceptance
    agree_terms: Joi.boolean().valid(true).required().messages({
      'any.only': 'You must agree to the terms and conditions'
    }),
    agree_privacy: Joi.boolean().valid(true).required().messages({
      'any.only': 'You must agree to the privacy policy'
    })
  })
};

// ================================
// LOGIN VALIDATION
// ================================

const loginSchema = {
  body: Joi.object({
    email: Joi.alternatives().try(
      commonSchemas.email,
      commonSchemas.username
    ).required().messages({
      'alternatives.match': 'Please provide a valid email or username'
    }),
    password: Joi.string().min(1).required().messages({
      'string.empty': 'Password is required'
    }),
    remember_me: Joi.boolean().default(false)
  })
};

// ================================
// PASSWORD VALIDATION
// ================================

const changePasswordSchema = {
  body: Joi.object({
    currentPassword: Joi.string().required().messages({
      'string.empty': 'Current password is required'
    }),
    newPassword: commonSchemas.password.required(),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
      'any.only': 'Password confirmation must match new password'
    })
  })
};

const forgotPasswordSchema = {
  body: Joi.object({
    email: commonSchemas.email.required()
  })
};

const resetPasswordSchema = {
  body: Joi.object({
    token: Joi.string().required().messages({
      'string.empty': 'Reset token is required'
    }),
    newPassword: commonSchemas.password.required(),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
      'any.only': 'Password confirmation must match new password'
    })
  })
};

// ================================
// EMAIL VERIFICATION VALIDATION
// ================================

const verifyEmailSchema = {
  body: Joi.object({
    token: Joi.string().required().messages({
      'string.empty': 'Verification token is required'
    })
  })
};

// ================================
// PROFILE VALIDATION
// ================================

const updateProfileSchema = {
  body: Joi.object({
    first_name: Joi.string().min(1).max(50).trim(),
    last_name: Joi.string().min(1).max(50).trim(),
    phone: commonSchemas.phone,
    bio: Joi.string().max(500).allow('').trim(),
    location: Joi.string().max(100).allow('').trim(),
    
    // Vendor-specific fields
    business_name: Joi.string().min(2).max(100).trim(),
    business_address: Joi.string().min(10).max(200).trim(),
    
    // Social links (optional)
    website: Joi.string().uri().allow(''),
    linkedin: Joi.string().uri().allow(''),
    twitter: Joi.string().uri().allow(''),
    instagram: Joi.string().uri().allow('')
  }).min(1).messages({
    'object.min': 'At least one field must be provided for update'
  })
};

// ================================
// VENDOR VERIFICATION VALIDATION
// ================================

const vendorVerificationSchema = {
  body: Joi.object({
    business_name: Joi.string().min(2).max(100).trim().required(),
    business_address: Joi.string().min(10).max(200).trim().required(),
    tax_id: Joi.string().min(5).max(50).trim().optional(),
    business_type: Joi.string().valid(
      'sole_proprietorship',
      'partnership',
      'corporation',
      'llc',
      'nonprofit',
      'other'
    ).required(),
    business_category: Joi.string().max(100).trim().required(),
    business_description: Joi.string().min(50).max(1000).trim().required(),
    years_in_business: Joi.number().integer().min(0).max(100).required(),
    expected_monthly_sales: Joi.number().min(0).required(),
    
    // Contact information
    business_phone: commonSchemas.phone.required(),
    business_email: commonSchemas.email.required(),
    
    // Bank account information (for payouts)
    bank_account_number: Joi.string().min(8).max(20).pattern(/^[0-9]+$/).required(),
    bank_routing_number: Joi.string().min(9).max(9).pattern(/^[0-9]+$/).required(),
    bank_account_holder: Joi.string().min(2).max(100).trim().required(),
    
    // Legal agreements
    agree_vendor_terms: Joi.boolean().valid(true).required(),
    agree_tax_compliance: Joi.boolean().valid(true).required()
  })
};

// ================================
// TOKEN VALIDATION
// ================================

const refreshTokenSchema = {
  body: Joi.object({
    refreshToken: Joi.string().optional() // Can also come from cookies
  })
};

// ================================
// ACCOUNT MANAGEMENT VALIDATION
// ================================

const deactivateAccountSchema = {
  body: Joi.object({
    reason: Joi.string().valid(
      'temporary_break',
      'privacy_concerns',
      'found_alternative',
      'too_complicated',
      'not_useful',
      'other'
    ).required(),
    feedback: Joi.string().max(500).allow('').trim(),
    confirm: Joi.boolean().valid(true).required().messages({
      'any.only': 'You must confirm account deactivation'
    })
  })
};

// ================================
// AVATAR UPLOAD VALIDATION
// ================================

const avatarUploadSchema = {
  // File validation happens in upload middleware
  // This is for any additional body data
  body: Joi.object({
    crop_x: Joi.number().min(0).optional(),
    crop_y: Joi.number().min(0).optional(),
    crop_width: Joi.number().min(1).optional(),
    crop_height: Joi.number().min(1).optional()
  })
};

// ================================
// TWO-FACTOR AUTHENTICATION (Future)
// ================================

const enable2FASchema = {
  body: Joi.object({
    password: Joi.string().required().messages({
      'string.empty': 'Password is required to enable 2FA'
    })
  })
};

const verify2FASchema = {
  body: Joi.object({
    code: Joi.string().length(6).pattern(/^[0-9]+$/).required().messages({
      'string.length': '2FA code must be 6 digits',
      'string.pattern.base': '2FA code must contain only numbers'
    }),
    backup_code: Joi.string().length(8).pattern(/^[A-Z0-9]+$/).optional()
  })
};

// ================================
// VALIDATION MIDDLEWARE EXPORTS
// ================================

module.exports = {
  // Registration & Login
  validateRegister: validate(registerSchema),
  validateLogin: validate(loginSchema),
  
  // Password Management
  validateChangePassword: validate(changePasswordSchema),
  validateForgotPassword: validate(forgotPasswordSchema),
  validateResetPassword: validate(resetPasswordSchema),
  
  // Email Verification
  validateVerifyEmail: validate(verifyEmailSchema),
  
  // Profile Management
  validateUpdateProfile: validate(updateProfileSchema),
  validateAvatarUpload: validate(avatarUploadSchema),
  
  // Vendor Verification
  validateVendorVerification: validate(vendorVerificationSchema),
  
  // Token Management
  validateRefreshToken: validate(refreshTokenSchema),
  
  // Account Management
  validateDeactivateAccount: validate(deactivateAccountSchema),
  
  // Two-Factor Authentication (Future)
  validateEnable2FA: validate(enable2FASchema),
  validateVerify2FA: validate(verify2FASchema),
  
  // Raw schemas for external use
  schemas: {
    register: registerSchema,
    login: loginSchema,
    changePassword: changePasswordSchema,
    forgotPassword: forgotPasswordSchema,
    resetPassword: resetPasswordSchema,
    verifyEmail: verifyEmailSchema,
    updateProfile: updateProfileSchema,
    vendorVerification: vendorVerificationSchema,
    refreshToken: refreshTokenSchema,
    deactivateAccount: deactivateAccountSchema,
    avatarUpload: avatarUploadSchema,
    enable2FA: enable2FASchema,
    verify2FA: verify2FASchema
  }
};