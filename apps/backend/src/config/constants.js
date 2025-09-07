// apps/backend/src/config/constants.js
// System-wide constants for VOID Marketplace

// ================================
// USER MANAGEMENT CONSTANTS
// ================================

const USER_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MODERATOR: 'MODERATOR',
  VENDOR: 'VENDOR',
  USER: 'USER'
};

const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BANNED: 'BANNED',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION'
};

// ================================
// LISTING MANAGEMENT CONSTANTS
// ================================

const LISTING_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  SOLD: 'SOLD',
  REMOVED: 'REMOVED',
  REJECTED: 'REJECTED'
};

const LISTING_CONDITION = {
  NEW: 'NEW',
  LIKE_NEW: 'LIKE_NEW',
  GOOD: 'GOOD',
  FAIR: 'FAIR',
  POOR: 'POOR'
};

// ================================
// TRANSACTION CONSTANTS
// ================================

const TRANSACTION_STATUS = {
  INITIATED: 'INITIATED',
  ESCROW_PENDING: 'ESCROW_PENDING',
  ESCROW_ACTIVE: 'ESCROW_ACTIVE',
  PAYMENT_RELEASED: 'PAYMENT_RELEASED',
  COMPLETED: 'COMPLETED',
  DISPUTED: 'DISPUTED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED'
};

const PAYMENT_METHODS = {
  STRIPE: 'stripe',
  PAYSTACK: 'paystack',
  BANK_TRANSFER: 'bank_transfer',
  CRYPTO: 'crypto'
};

// ================================
// CHAT & MESSAGING CONSTANTS
// ================================

const CHAT_STATUS = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
  BLOCKED: 'BLOCKED'
};

const MESSAGE_TYPE = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  OFFER: 'OFFER',
  COUNTER_OFFER: 'COUNTER_OFFER',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  OFFER_REJECTED: 'OFFER_REJECTED',
  FILE: 'FILE',
  SYSTEM: 'SYSTEM'
};

// ================================
// NOTIFICATION CONSTANTS
// ================================

const NOTIFICATION_TYPE = {
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  OFFER_RECEIVED: 'OFFER_RECEIVED',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  OFFER_REJECTED: 'OFFER_REJECTED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  PRODUCT_SOLD: 'PRODUCT_SOLD',
  ADMIN_ALERT: 'ADMIN_ALERT',
  SYSTEM_UPDATE: 'SYSTEM_UPDATE',
  LISTING_APPROVED: 'LISTING_APPROVED',
  LISTING_REJECTED: 'LISTING_REJECTED',
  VENDOR_VERIFIED: 'VENDOR_VERIFIED',
  TRANSACTION_UPDATE: 'TRANSACTION_UPDATE'
};

// ================================
// SUBSCRIPTION CONSTANTS
// ================================

const SUBSCRIPTION_PLAN = {
  FREE: 'FREE',
  BASIC: 'BASIC',
  PREMIUM: 'PREMIUM',
  ENTERPRISE: 'ENTERPRISE'
};

const SUBSCRIPTION_STATUS = {
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  PENDING: 'PENDING'
};

// ================================
// PROMOTION CONSTANTS
// ================================

const PROMOTION_TYPE = {
  PERCENTAGE_DISCOUNT: 'PERCENTAGE_DISCOUNT',
  FIXED_AMOUNT: 'FIXED_AMOUNT',
  FREE_SHIPPING: 'FREE_SHIPPING',
  BUY_ONE_GET_ONE: 'BUY_ONE_GET_ONE'
};

// ================================
// BUSINESS RULES
// ================================

const BUSINESS_RULES = {
  // Platform fees
  PLATFORM_FEE_PERCENTAGE: 0.05, // 5%
  PAYMENT_PROCESSING_FEE: 0.029, // 2.9%
  
  // Escrow settings
  ESCROW_RELEASE_DAYS: 7,
  DISPUTE_RESOLUTION_DAYS: 14,
  
  // File upload limits
  MAX_IMAGES_PER_LISTING: 10,
  MAX_VIDEOS_PER_LISTING: 1,
  MAX_3D_MODELS_PER_LISTING: 3,
  MAX_FILE_SIZE_MB: 100,
  MAX_IMAGE_SIZE_MB: 10,
  MAX_VIDEO_SIZE_MB: 100,
  MAX_3D_MODEL_SIZE_MB: 50,
  
  // Search and pagination
  DEFAULT_PAGE_SIZE: 24,
  MAX_PAGE_SIZE: 100,
  MAX_SEARCH_RESULTS: 1000,
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: 100,
  
  // Token expiration
  ACCESS_TOKEN_EXPIRES_IN: '15m',
  REFRESH_TOKEN_EXPIRES_IN: '7d',
  EMAIL_VERIFICATION_EXPIRES_IN: '24h',
  PASSWORD_RESET_EXPIRES_IN: '1h',
  
  // User limits
  MAX_LISTINGS_PER_USER: 100,
  MAX_CHATS_PER_USER: 50,
  MAX_TRANSACTIONS_PER_DAY: 10,
  
  // Search settings
  SIMILARITY_THRESHOLD: 0.7,
  MAX_AUTOCOMPLETE_SUGGESTIONS: 10,
  SEARCH_CACHE_TTL_SECONDS: 300, // 5 minutes
  
  // Vendor verification
  VENDOR_VERIFICATION_REQUIRED_DOCUMENTS: [
    'business_license',
    'tax_id',
    'identity_verification'
  ]
};

// ================================
// API CONFIGURATION
// ================================

const API_CONFIG = {
  VERSION: 'v1',
  BASE_URL: process.env.API_BASE_URL || 'http://localhost:5000',
  
  // JWT Configuration
  JWT: {
    ISSUER: 'void-marketplace',
    AUDIENCE: 'void-marketplace-users',
    ALGORITHM: 'HS256'
  },
  
  // Database settings
  DATABASE: {
    CONNECTION_TIMEOUT: 10000,
    QUERY_TIMEOUT: 30000,
    MAX_CONNECTIONS: 100
  },
  
  // File storage
  STORAGE: {
    TYPE: process.env.STORAGE_TYPE || 'local', // 'local' or 's3'
    LOCAL_PATH: './uploads',
    S3_BUCKET: process.env.AWS_S3_BUCKET,
    CDN_URL: process.env.CDN_URL
  },
  
  // External APIs
  STRIPE: {
    WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    SUCCESS_URL: process.env.FRONTEND_URL + '/payment/success',
    CANCEL_URL: process.env.FRONTEND_URL + '/payment/cancel'
  },
  
  OPENAI: {
    MODEL: 'text-embedding-ada-002',
    MAX_TOKENS: 1000,
    TEMPERATURE: 0.1
  },
  
  HUGGINGFACE: {
    BASE_URL: 'https://api-inference.huggingface.co/models',
    AVAILABLE_MODELS: {
      PRIMARY: 'sentence-transformers/all-MiniLM-L6-v2',
      SECONDARY: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
    },
    ENDPOINT: '/feature-extraction',
    TIMEOUT: 30000
  },
  
  // Feature flags
  FEATURES: {
    ENABLE_AI_SEARCH: process.env.ENABLE_AI_SEARCH === 'true',
    ENABLE_IMAGE_SEARCH: process.env.ENABLE_IMAGE_SEARCH === 'true',
    ENABLE_3D_MODELS: process.env.ENABLE_3D_MODELS === 'true',
    ENABLE_VIDEO_UPLOAD: process.env.ENABLE_VIDEO_UPLOAD === 'true',
    ENABLE_REAL_TIME_CHAT: true,
    ENABLE_NOTIFICATIONS: true,
    ENABLE_ANALYTICS: true,
    ENABLE_ADVANCED_FEATURES: process.env.NODE_ENV === 'production'
  },
  
  // Cache settings
  CACHE: {
    REDIS_URL: process.env.REDIS_URL,
    DEFAULT_TTL: 300, // 5 minutes
    SEARCH_TTL: 600, // 10 minutes
    USER_SESSION_TTL: 86400 // 24 hours
  }
};

// ================================
// ERROR CODES
// ================================

const ERROR_CODES = {
  // Authentication errors
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_CREDENTIALS_INVALID: 'AUTH_CREDENTIALS_INVALID',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_INSUFFICIENT_PERMISSIONS',
  AUTH_ACCOUNT_SUSPENDED: 'AUTH_ACCOUNT_SUSPENDED',
  AUTH_EMAIL_NOT_VERIFIED: 'AUTH_EMAIL_NOT_VERIFIED',
  
  // Validation errors
  VALIDATION_REQUIRED_FIELD: 'VALIDATION_REQUIRED_FIELD',
  VALIDATION_INVALID_FORMAT: 'VALIDATION_INVALID_FORMAT',
  VALIDATION_OUT_OF_RANGE: 'VALIDATION_OUT_OF_RANGE',
  VALIDATION_DUPLICATE_VALUE: 'VALIDATION_DUPLICATE_VALUE',
  
  // Business logic errors
  BUSINESS_INSUFFICIENT_FUNDS: 'BUSINESS_INSUFFICIENT_FUNDS',
  BUSINESS_LISTING_NOT_AVAILABLE: 'BUSINESS_LISTING_NOT_AVAILABLE',
  BUSINESS_TRANSACTION_FAILED: 'BUSINESS_TRANSACTION_FAILED',
  BUSINESS_ESCROW_ERROR: 'BUSINESS_ESCROW_ERROR',
  
  // File upload errors
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_INVALID_TYPE: 'FILE_INVALID_TYPE',
  FILE_UPLOAD_FAILED: 'FILE_UPLOAD_FAILED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  
  // Database errors
  DATABASE_CONNECTION_ERROR: 'DATABASE_CONNECTION_ERROR',
  DATABASE_QUERY_ERROR: 'DATABASE_QUERY_ERROR',
  DATABASE_CONSTRAINT_ERROR: 'DATABASE_CONSTRAINT_ERROR',
  
  // External service errors
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  PAYMENT_GATEWAY_ERROR: 'PAYMENT_GATEWAY_ERROR',
  EMAIL_SERVICE_ERROR: 'EMAIL_SERVICE_ERROR',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED'
};

// ================================
// VALIDATION PATTERNS
// ================================

const VALIDATION_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^\+?[\d\s\-\(\)]+$/,
  USERNAME: /^[a-zA-Z0-9_]{3,30}$/,
  SKU: /^[A-Z0-9\-_]{3,50}$/,
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
  CURRENCY: /^\d+(\.\d{1,2})?$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
};

// ================================
// ALLOWED FILE TYPES
// ================================

const ALLOWED_FILE_TYPES = {
  IMAGES: [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/webp',
    'image/gif'
  ],
  VIDEOS: [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo' // .avi
  ],
  MODELS_3D: [
    'model/gltf-binary', // .glb
    'application/octet-stream', // .obj, .glb
    'model/gltf+json' // .gltf
  ],
  DOCUMENTS: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
};

// ================================
// ROLE PERMISSIONS MATRIX
// ================================

const ROLE_PERMISSIONS = {
  [USER_ROLES.SUPER_ADMIN]: [
    'users:read',
    'users:write',
    'users:delete',
    'listings:read',
    'listings:write',
    'listings:delete',
    'listings:approve',
    'transactions:read',
    'transactions:write',
    'admin:access',
    'system:manage'
  ],
  
  [USER_ROLES.ADMIN]: [
    'users:read',
    'users:write',
    'listings:read',
    'listings:write',
    'listings:approve',
    'transactions:read',
    'admin:access'
  ],
  
  [USER_ROLES.MODERATOR]: [
    'listings:read',
    'listings:approve',
    'users:read',
    'admin:access'
  ],
  
  [USER_ROLES.VENDOR]: [
    'listings:read',
    'listings:write',
    'listings:own',
    'transactions:read',
    'transactions:own',
    'chats:access',
    'notifications:receive'
  ],
  
  [USER_ROLES.USER]: [
    'listings:read',
    'transactions:read',
    'transactions:own',
    'chats:access',
    'notifications:receive'
  ]
};

// ================================
// SUBSCRIPTION FEATURES
// ================================

const SUBSCRIPTION_FEATURES = {
  [SUBSCRIPTION_PLAN.FREE]: {
    max_listings: 5,
    max_images_per_listing: 3,
    priority_support: false,
    analytics: false,
    custom_branding: false,
    api_access: false
  },
  
  [SUBSCRIPTION_PLAN.BASIC]: {
    max_listings: 25,
    max_images_per_listing: 10,
    priority_support: false,
    analytics: true,
    custom_branding: false,
    api_access: false
  },
  
  [SUBSCRIPTION_PLAN.PREMIUM]: {
    max_listings: 100,
    max_images_per_listing: 10,
    priority_support: true,
    analytics: true,
    custom_branding: true,
    api_access: true
  },
  
  [SUBSCRIPTION_PLAN.ENTERPRISE]: {
    max_listings: -1, // unlimited
    max_images_per_listing: 10,
    priority_support: true,
    analytics: true,
    custom_branding: true,
    api_access: true
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Core enums
  USER_ROLES,
  USER_STATUS,
  LISTING_STATUS,
  LISTING_CONDITION,
  TRANSACTION_STATUS,
  PAYMENT_METHODS,
  CHAT_STATUS,
  MESSAGE_TYPE,
  NOTIFICATION_TYPE,
  SUBSCRIPTION_PLAN,
  SUBSCRIPTION_STATUS,
  PROMOTION_TYPE,
  
  // Configuration
  BUSINESS_RULES,
  API_CONFIG,
  ERROR_CODES,
  VALIDATION_PATTERNS,
  ALLOWED_FILE_TYPES,
  ROLE_PERMISSIONS,
  SUBSCRIPTION_FEATURES
};