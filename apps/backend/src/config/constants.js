// apps/backend/src/config/constants.js
// System-wide constants for VOID Marketplace

// ================================
// USER ROLES & PERMISSIONS
// ================================

const USER_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MODERATOR: 'MODERATOR',
  VENDOR: 'VENDOR',
  USER: 'USER'
};

const ROLE_PERMISSIONS = {
  [USER_ROLES.SUPER_ADMIN]: [
    'manage_all_users',
    'manage_all_vendors',
    'manage_all_listings',
    'manage_all_transactions',
    'manage_disputes',
    'manage_roles',
    'view_analytics',
    'manage_promotions',
    'manage_subscriptions',
    'system_settings'
  ],
  [USER_ROLES.ADMIN]: [
    'manage_users',
    'manage_vendors',
    'manage_listings',
    'manage_transactions',
    'view_analytics',
    'manage_promotions',
    'basic_dispute_resolution'
  ],
  [USER_ROLES.MODERATOR]: [
    'moderate_listings',
    'moderate_reviews',
    'basic_user_actions',
    'basic_dispute_resolution'
  ],
  [USER_ROLES.VENDOR]: [
    'create_listings',
    'manage_own_listings',
    'view_own_analytics',
    'manage_own_promotions',
    'respond_to_chats'
  ],
  [USER_ROLES.USER]: [
    'browse_listings',
    'search_products',
    'initiate_chats',
    'make_purchases',
    'leave_reviews'
  ]
};

// ================================
// STATUS ENUMS
// ================================

const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BANNED: 'BANNED',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION'
};

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

const TRANSACTION_STATUS = {
  INITIATED: 'INITIATED',
  ESCROW: 'ESCROW',
  ESCROW_PENDING: 'ESCROW_PENDING',
  ESCROW_ACTIVE: 'ESCROW_ACTIVE',
  PAYMENT_RELEASED: 'PAYMENT_RELEASED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'COMPLETED',
  DISPUTED: 'DISPUTED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
  RETURN_REQUESTED: 'RETURN_REQUESTED'
};

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
  OFFER_REJECTED: 'OFFER_REJECTED'
};

const NOTIFICATION_TYPE = {
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  OFFER_RECEIVED: 'OFFER_RECEIVED',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  OFFER_REJECTED: 'OFFER_REJECTED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  PRODUCT_SOLD: 'PRODUCT_SOLD',
  ADMIN_ALERT: 'ADMIN_ALERT',
  SYSTEM_UPDATE: 'SYSTEM_UPDATE'
};

const INTERACTION_TYPE = {
  VIEW: 'VIEW',
  LIKE: 'LIKE',
  SHARE: 'SHARE',
  PURCHASE: 'PURCHASE',
  CART_ADD: 'CART_ADD',
  SEARCH_CLICK: 'SEARCH_CLICK'
};

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

const PROMOTION_TYPE = {
  PERCENTAGE_DISCOUNT: 'PERCENTAGE_DISCOUNT',
  FIXED_DISCOUNT: 'FIXED_DISCOUNT',
  FREE_SHIPPING: 'FREE_SHIPPING',
  BUY_ONE_GET_ONE: 'BUY_ONE_GET_ONE'
};

// ================================
// FILE UPLOAD CONFIGURATIONS
// ================================

const UPLOAD_LIMITS = {
  IMAGES: {
    MAX_COUNT: 10,
    MAX_SIZE: 5 * 1024 * 1024, // 5MB per image
    ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.webp']
  },
  VIDEOS: {
    MAX_COUNT: 1,
    MAX_SIZE: 100 * 1024 * 1024, // 100MB
    MAX_DURATION: 300, // 5 minutes in seconds
    ALLOWED_TYPES: ['video/mp4', 'video/webm', 'video/quicktime'],
    ALLOWED_EXTENSIONS: ['.mp4', '.webm', '.mov']
  },
  MODELS_3D: {
    MAX_COUNT: 3,
    MAX_SIZE: 50 * 1024 * 1024, // 50MB per model
    ALLOWED_TYPES: ['model/gltf-binary', 'application/octet-stream'],
    ALLOWED_EXTENSIONS: ['.glb', '.obj', '.gltf']
  },
  AVATARS: {
    MAX_SIZE: 2 * 1024 * 1024, // 2MB
    ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.webp']
  }
};

// ================================
// BUSINESS RULES & FEES
// ================================

const BUSINESS_RULES = {
  PLATFORM_FEE_PERCENTAGE: 0.05, // 5% platform fee
  ESCROW_RELEASE_DAYS: 7, // Days to auto-release escrow
  MAX_NEGOTIATION_ROUNDS: 10,
  MIN_LISTING_PRICE: 1.00,
  MAX_LISTING_PRICE: 999999.99,
  REVIEW_WINDOW_DAYS: 30, // Days to leave review after purchase
  CHAT_MESSAGE_MAX_LENGTH: 1000,
  LISTING_TITLE_MAX_LENGTH: 100,
  LISTING_DESCRIPTION_MAX_LENGTH: 5000,
  MAX_TAGS_PER_LISTING: 10,
  TAG_MAX_LENGTH: 30
};

const SUBSCRIPTION_FEATURES = {
  [SUBSCRIPTION_PLAN.FREE]: {
    max_listings: 5,
    max_images_per_listing: 3,
    max_videos_per_listing: 0,
    max_3d_models_per_listing: 0,
    featured_listings: 0,
    analytics_access: false,
    promotion_tools: false,
    priority_support: false,
    custom_branding: false
  },
  [SUBSCRIPTION_PLAN.BASIC]: {
    max_listings: 25,
    max_images_per_listing: 6,
    max_videos_per_listing: 1,
    max_3d_models_per_listing: 1,
    featured_listings: 1,
    analytics_access: true,
    promotion_tools: true,
    priority_support: false,
    custom_branding: false
  },
  [SUBSCRIPTION_PLAN.PREMIUM]: {
    max_listings: 100,
    max_images_per_listing: 10,
    max_videos_per_listing: 1,
    max_3d_models_per_listing: 3,
    featured_listings: 5,
    analytics_access: true,
    promotion_tools: true,
    priority_support: true,
    custom_branding: true
  },
  [SUBSCRIPTION_PLAN.ENTERPRISE]: {
    max_listings: -1, // Unlimited
    max_images_per_listing: 10,
    max_videos_per_listing: 1,
    max_3d_models_per_listing: 3,
    featured_listings: 20,
    analytics_access: true,
    promotion_tools: true,
    priority_support: true,
    custom_branding: true
  }
};

// ================================
// AI/ML CONFIGURATIONS
// ================================

const AI_CONFIG = {
  IMAGE_EMBEDDING: {
    MODEL_NAME: 'clip-vit-base-patch32',
    EMBEDDING_SIZE: 512,
    MAX_IMAGE_SIZE: 224, // pixels
    SIMILARITY_THRESHOLD: 0.7
  },
  TEXT_EMBEDDING: {
    MODEL_NAME: 'all-MiniLM-L6-v2',
    EMBEDDING_SIZE: 384,
    MAX_TEXT_LENGTH: 500,
    SIMILARITY_THRESHOLD: 0.6
  },
  RECOMMENDATIONS: {
    TRENDING_WEIGHT: 0.3,
    POPULARITY_WEIGHT: 0.3,
    SIMILARITY_WEIGHT: 0.4,
    MAX_RECOMMENDATIONS: 20,
    CACHE_DURATION: 3600 // 1 hour in seconds
  },
  FUZZY_SEARCH: {
    THRESHOLD: 0.4,
    MAX_RESULTS: 50,
    INCLUDE_SCORE: true
  }
};

// ================================
// API CONFIGURATIONS
// ================================

const API_CONFIG = {
  VERSION: 'v1',
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 100,
    AUTH_MAX_REQUESTS: 10
  },
  JWT: {
    ACCESS_TOKEN_EXPIRY: '15m',
    REFRESH_TOKEN_EXPIRY: '7d',
    ISSUER: 'void-marketplace',
    AUDIENCE: 'void-marketplace-users'
  },
  SEARCH: {
    MIN_QUERY_LENGTH: 2,
    MAX_QUERY_LENGTH: 100,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100
  }
};

// ================================
// ERROR CODES
// ================================

const ERROR_CODES = {
  // Authentication
  AUTH_INVALID_CREDENTIALS: 'AUTH_001',
  AUTH_TOKEN_EXPIRED: 'AUTH_002',
  AUTH_TOKEN_INVALID: 'AUTH_003',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_004',
  AUTH_ACCOUNT_SUSPENDED: 'AUTH_005',
  
  // Validation
  VALIDATION_FAILED: 'VAL_001',
  VALIDATION_MISSING_FIELD: 'VAL_002',
  VALIDATION_INVALID_FORMAT: 'VAL_003',
  
  // Resource
  RESOURCE_NOT_FOUND: 'RES_001',
  RESOURCE_ALREADY_EXISTS: 'RES_002',
  RESOURCE_CONFLICT: 'RES_003',
  
  // Upload
  UPLOAD_FILE_TOO_LARGE: 'UPL_001',
  UPLOAD_INVALID_TYPE: 'UPL_002',
  UPLOAD_FAILED: 'UPL_003',
  
  // Business Logic
  BUSINESS_INSUFFICIENT_FUNDS: 'BIZ_001',
  BUSINESS_LISTING_LIMIT_EXCEEDED: 'BIZ_002',
  BUSINESS_TRANSACTION_FAILED: 'BIZ_003'
};

// ================================
// NOTIFICATION TEMPLATES
// ================================

const NOTIFICATION_TEMPLATES = {
  [NOTIFICATION_TYPE.CHAT_MESSAGE]: {
    title: 'New Message',
    template: 'You have a new message from {senderName}'
  },
  [NOTIFICATION_TYPE.OFFER_RECEIVED]: {
    title: 'New Offer',
    template: '{buyerName} made an offer of ${amount} for {listingTitle}'
  },
  [NOTIFICATION_TYPE.OFFER_ACCEPTED]: {
    title: 'Offer Accepted',
    template: 'Your offer of ${amount} for {listingTitle} has been accepted'
  },
  [NOTIFICATION_TYPE.OFFER_REJECTED]: {
    title: 'Offer Declined',
    template: 'Your offer of ${amount} for {listingTitle} has been declined'
  },
  [NOTIFICATION_TYPE.PAYMENT_RECEIVED]: {
    title: 'Payment Received',
    template: 'You received ${amount} for {listingTitle}'
  },
  [NOTIFICATION_TYPE.PRODUCT_SOLD]: {
    title: 'Product Sold',
    template: 'Your listing "{listingTitle}" has been sold'
  }
};

module.exports = {
  USER_ROLES,
  ROLE_PERMISSIONS,
  USER_STATUS,
  LISTING_STATUS,
  LISTING_CONDITION,
  TRANSACTION_STATUS,
  CHAT_STATUS,
  MESSAGE_TYPE,
  NOTIFICATION_TYPE,
  INTERACTION_TYPE,
  SUBSCRIPTION_PLAN,
  SUBSCRIPTION_STATUS,
  PROMOTION_TYPE,
  UPLOAD_LIMITS,
  BUSINESS_RULES,
  SUBSCRIPTION_FEATURES,
  AI_CONFIG,
  API_CONFIG,
  ERROR_CODES,
  NOTIFICATION_TEMPLATES
};