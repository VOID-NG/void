// apps/backend/src/config/transactionConstants.js
// Comprehensive transaction-related constants and enums

// ================================
// TRANSACTION STATUS FLOW
// ================================

const TRANSACTION_STATUS = {
    // Initial states
    INITIATED: 'INITIATED',                 // Transaction created, awaiting payment
    PAYMENT_PENDING: 'PAYMENT_PENDING',     // Payment processing
    
    // Payment completed states
    ESCROW: 'ESCROW',                       // Payment held in escrow
    SHIPPED: 'SHIPPED',                     // Item shipped by vendor
    DELIVERED: 'DELIVERED',                 // Delivery confirmed by buyer
    
    // Final states
    COMPLETED: 'COMPLETED',                 // Transaction successfully completed
    CANCELLED: 'CANCELLED',                 // Transaction cancelled
    DISPUTED: 'DISPUTED',                   // Under dispute resolution
    REFUNDED: 'REFUNDED',                   // Refund processed
    FAILED: 'FAILED',                       // Payment or transaction failed
    
    // Return/Exchange states
    RETURN_REQUESTED: 'RETURN_REQUESTED',   // Buyer requested return
    RETURN_APPROVED: 'RETURN_APPROVED',     // Return approved by vendor
    RETURN_SHIPPED: 'RETURN_SHIPPED',       // Item returned by buyer
    RETURN_RECEIVED: 'RETURN_RECEIVED',     // Return received by vendor
    EXCHANGED: 'EXCHANGED'                  // Item exchanged
  };
  
  // Valid status transitions
  const TRANSACTION_STATUS_TRANSITIONS = {
    [TRANSACTION_STATUS.INITIATED]: [
      TRANSACTION_STATUS.PAYMENT_PENDING,
      TRANSACTION_STATUS.CANCELLED,
      TRANSACTION_STATUS.FAILED
    ],
    [TRANSACTION_STATUS.PAYMENT_PENDING]: [
      TRANSACTION_STATUS.ESCROW,
      TRANSACTION_STATUS.FAILED,
      TRANSACTION_STATUS.CANCELLED
    ],
    [TRANSACTION_STATUS.ESCROW]: [
      TRANSACTION_STATUS.SHIPPED,
      TRANSACTION_STATUS.COMPLETED,
      TRANSACTION_STATUS.DISPUTED,
      TRANSACTION_STATUS.CANCELLED,
      TRANSACTION_STATUS.REFUNDED
    ],
    [TRANSACTION_STATUS.SHIPPED]: [
      TRANSACTION_STATUS.DELIVERED,
      TRANSACTION_STATUS.DISPUTED,
      TRANSACTION_STATUS.RETURN_REQUESTED
    ],
    [TRANSACTION_STATUS.DELIVERED]: [
      TRANSACTION_STATUS.COMPLETED,
      TRANSACTION_STATUS.RETURN_REQUESTED,
      TRANSACTION_STATUS.DISPUTED
    ],
    [TRANSACTION_STATUS.DISPUTED]: [
      TRANSACTION_STATUS.COMPLETED,
      TRANSACTION_STATUS.REFUNDED,
      TRANSACTION_STATUS.CANCELLED
    ],
    [TRANSACTION_STATUS.RETURN_REQUESTED]: [
      TRANSACTION_STATUS.RETURN_APPROVED,
      TRANSACTION_STATUS.DISPUTED,
      TRANSACTION_STATUS.COMPLETED
    ],
    [TRANSACTION_STATUS.RETURN_APPROVED]: [
      TRANSACTION_STATUS.RETURN_SHIPPED,
      TRANSACTION_STATUS.CANCELLED
    ],
    [TRANSACTION_STATUS.RETURN_SHIPPED]: [
      TRANSACTION_STATUS.RETURN_RECEIVED,
      TRANSACTION_STATUS.DISPUTED
    ],
    [TRANSACTION_STATUS.RETURN_RECEIVED]: [
      TRANSACTION_STATUS.REFUNDED,
      TRANSACTION_STATUS.EXCHANGED
    ]
  };
  
  // ================================
  // PAYMENT METHODS
  // ================================
  
  const PAYMENT_METHOD = {
    STRIPE: 'stripe',
    PAYPAL: 'paypal',
    APPLE_PAY: 'apple_pay',
    GOOGLE_PAY: 'google_pay',
    BANK_TRANSFER: 'bank_transfer',
    CRYPTOCURRENCY: 'cryptocurrency'
  };
  
  const PAYMENT_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    REFUNDED: 'refunded',
    PARTIALLY_REFUNDED: 'partially_refunded'
  };
  
  // ================================
  // SHIPPING & FULFILLMENT
  // ================================
  
  const SHIPPING_CARRIER = {
    UPS: 'ups',
    FEDEX: 'fedex',
    USPS: 'usps',
    DHL: 'dhl',
    AMAZON: 'amazon',
    OTHER: 'other'
  };
  
  const SHIPPING_STATUS = {
    PENDING: 'pending',
    PICKED_UP: 'picked_up',
    IN_TRANSIT: 'in_transit',
    OUT_FOR_DELIVERY: 'out_for_delivery',
    DELIVERED: 'delivered',
    DELIVERY_ATTEMPTED: 'delivery_attempted',
    RETURNED_TO_SENDER: 'returned_to_sender',
    LOST: 'lost',
    DAMAGED: 'damaged'
  };
  
  const DELIVERY_METHOD = {
    STANDARD: 'standard',
    EXPEDITED: 'expedited',
    OVERNIGHT: 'overnight',
    PICKUP: 'pickup',
    DIGITAL: 'digital'
  };
  
  // ================================
  // DISPUTE TYPES & REASONS
  // ================================
  
  const DISPUTE_REASON = {
    ITEM_NOT_RECEIVED: 'item_not_received',
    ITEM_DEFECTIVE: 'item_defective',
    NOT_AS_DESCRIBED: 'not_as_described',
    UNAUTHORIZED_CHARGE: 'unauthorized_charge',
    BILLING_ISSUE: 'billing_issue',
    REFUND_NOT_PROCESSED: 'refund_not_processed',
    VENDOR_UNRESPONSIVE: 'vendor_unresponsive',
    DELIVERY_ISSUE: 'delivery_issue',
    QUALITY_ISSUE: 'quality_issue',
    SHIPPING_DAMAGE: 'shipping_damage'
  };
  
  const DISPUTE_STATUS = {
    OPEN: 'open',
    UNDER_REVIEW: 'under_review',
    AWAITING_RESPONSE: 'awaiting_response',
    ESCALATED: 'escalated',
    RESOLVED: 'resolved',
    CLOSED: 'closed',
    WITHDRAWN: 'withdrawn'
  };
  
  const DISPUTE_RESOLUTION = {
    FAVOR_BUYER: 'favor_buyer',
    FAVOR_VENDOR: 'favor_vendor',
    PARTIAL_REFUND: 'partial_refund',
    REPLACEMENT: 'replacement',
    STORE_CREDIT: 'store_credit',
    NO_ACTION: 'no_action'
  };
  
  // ================================
  // REFUND TYPES & REASONS
  // ================================
  
  const REFUND_TYPE = {
    FULL: 'full',
    PARTIAL: 'partial',
    SHIPPING_ONLY: 'shipping_only',
    TAX_ONLY: 'tax_only'
  };
  
  const REFUND_REASON = {
    BUYER_REQUEST: 'buyer_request',
    DEFECTIVE_ITEM: 'defective_item',
    NOT_AS_DESCRIBED: 'not_as_described',
    SHIPPING_DAMAGE: 'shipping_damage',
    VENDOR_ERROR: 'vendor_error',
    ADMIN_DECISION: 'admin_decision',
    DISPUTE_RESOLUTION: 'dispute_resolution',
    FRAUD_PREVENTION: 'fraud_prevention',
    CANCELLED_ORDER: 'cancelled_order'
  };
  
  const REFUND_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  };
  
  // ================================
  // RETURN TYPES & REASONS
  // ================================
  
  const RETURN_REASON = {
    DEFECTIVE: 'defective',
    NOT_AS_DESCRIBED: 'not_as_described',
    WRONG_ITEM: 'wrong_item',
    DAMAGED_SHIPPING: 'damaged_shipping',
    CHANGED_MIND: 'changed_mind',
    SIZING_ISSUE: 'sizing_issue',
    QUALITY_ISSUE: 'quality_issue',
    COMPATIBILITY_ISSUE: 'compatibility_issue'
  };
  
  const RETURN_TYPE = {
    REFUND: 'refund',
    EXCHANGE: 'exchange',
    STORE_CREDIT: 'store_credit',
    REPAIR: 'repair'
  };
  
  const RETURN_STATUS = {
    REQUESTED: 'requested',
    APPROVED: 'approved',
    DENIED: 'denied',
    SHIPPED: 'shipped',
    RECEIVED: 'received',
    PROCESSED: 'processed',
    COMPLETED: 'completed'
  };
  
  const ITEM_CONDITION = {
    UNOPENED: 'unopened',
    OPENED_UNUSED: 'opened_unused',
    LIGHTLY_USED: 'lightly_used',
    HEAVILY_USED: 'heavily_used',
    DAMAGED: 'damaged',
    DEFECTIVE: 'defective'
  };
  
  // ================================
  // TRANSACTION FEES & CALCULATIONS
  // ================================
  
  const FEE_TYPE = {
    PLATFORM_FEE: 'platform_fee',
    PAYMENT_PROCESSING: 'payment_processing',
    SHIPPING: 'shipping',
    TAX: 'tax',
    INSURANCE: 'insurance',
    HANDLING: 'handling'
  };
  
  const FEE_CALCULATION_METHOD = {
    PERCENTAGE: 'percentage',
    FIXED: 'fixed',
    TIERED: 'tiered',
    HYBRID: 'hybrid'
  };
  
  // Platform fee structure
  const PLATFORM_FEES = {
    STANDARD_RATE: 0.05,        // 5% standard platform fee
    PREMIUM_RATE: 0.03,         // 3% for premium vendors
    ENTERPRISE_RATE: 0.02,      // 2% for enterprise vendors
    MINIMUM_FEE: 0.50,          // Minimum $0.50 fee
    MAXIMUM_FEE: 500.00         // Maximum $500 fee
  };
  
  // Payment processing fees (Stripe)
  const PAYMENT_PROCESSING_FEES = {
    CARD_RATE: 0.029,           // 2.9% + $0.30 for card payments
    CARD_FIXED: 0.30,
    ACH_RATE: 0.008,            // 0.8% for ACH, capped at $5
    ACH_CAP: 5.00,
    INTERNATIONAL_RATE: 0.039,   // 3.9% + $0.30 for international cards
    INTERNATIONAL_FIXED: 0.30
  };
  
  // ================================
  // ESCROW MANAGEMENT
  // ================================
  
  const ESCROW_STATUS = {
    PENDING: 'pending',
    ACTIVE: 'active',
    RELEASED: 'released',
    DISPUTED: 'disputed',
    REFUNDED: 'refunded',
    EXPIRED: 'expired'
  };
  
  const ESCROW_RELEASE_TRIGGER = {
    MANUAL: 'manual',
    AUTOMATIC: 'automatic',
    DELIVERY_CONFIRMATION: 'delivery_confirmation',
    TIME_BASED: 'time_based',
    DISPUTE_RESOLUTION: 'dispute_resolution'
  };
  
  // Escrow configuration
  const ESCROW_CONFIG = {
    DEFAULT_HOLD_DAYS: 7,       // Default escrow hold period
    MAX_HOLD_DAYS: 30,          // Maximum escrow hold period
    MIN_HOLD_DAYS: 1,           // Minimum escrow hold period
    AUTO_RELEASE_DELAY: 24,     // Hours to wait after delivery before auto-release
    DISPUTE_HOLD_DAYS: 30       // Additional hold during disputes
  };
  
  // ================================
  // TRANSACTION ANALYTICS
  // ================================
  
  const ANALYTICS_METRICS = {
    TOTAL_VOLUME: 'total_volume',
    TRANSACTION_COUNT: 'transaction_count',
    AVERAGE_ORDER_VALUE: 'average_order_value',
    SUCCESS_RATE: 'success_rate',
    REFUND_RATE: 'refund_rate',
    DISPUTE_RATE: 'dispute_rate',
    COMPLETION_TIME: 'completion_time',
    PAYMENT_FAILURE_RATE: 'payment_failure_rate'
  };
  
  const ANALYTICS_DIMENSIONS = {
    TIME: 'time',
    VENDOR: 'vendor',
    CATEGORY: 'category',
    PAYMENT_METHOD: 'payment_method',
    GEOGRAPHY: 'geography',
    DEVICE: 'device'
  };
  
  const ANALYTICS_TIME_PERIODS = {
    HOUR: 'hour',
    DAY: 'day',
    WEEK: 'week',
    MONTH: 'month',
    QUARTER: 'quarter',
    YEAR: 'year'
  };
  
  // ================================
  // NOTIFICATION TRIGGERS
  // ================================
  
  const TRANSACTION_EVENTS = {
    CREATED: 'transaction_created',
    PAYMENT_SUCCEEDED: 'payment_succeeded',
    PAYMENT_FAILED: 'payment_failed',
    SHIPPED: 'transaction_shipped',
    DELIVERED: 'transaction_delivered',
    COMPLETED: 'transaction_completed',
    CANCELLED: 'transaction_cancelled',
    DISPUTED: 'transaction_disputed',
    REFUNDED: 'transaction_refunded',
    RETURN_REQUESTED: 'return_requested',
    ESCROW_RELEASED: 'escrow_released'
  };
  
  // ================================
  // ERROR CODES
  // ================================
  
  const TRANSACTION_ERROR_CODES = {
    // Payment errors
    PAYMENT_DECLINED: 'PAYMENT_DECLINED',
    INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
    PAYMENT_METHOD_INVALID: 'PAYMENT_METHOD_INVALID',
    PAYMENT_PROCESSING_ERROR: 'PAYMENT_PROCESSING_ERROR',
    
    // Transaction errors
    TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
    INVALID_TRANSACTION_STATUS: 'INVALID_TRANSACTION_STATUS',
    UNAUTHORIZED_TRANSACTION_ACCESS: 'UNAUTHORIZED_TRANSACTION_ACCESS',
    TRANSACTION_ALREADY_PROCESSED: 'TRANSACTION_ALREADY_PROCESSED',
    
    // Business logic errors
    LISTING_UNAVAILABLE: 'LISTING_UNAVAILABLE',
    VENDOR_INACTIVE: 'VENDOR_INACTIVE',
    BUYER_RESTRICTED: 'BUYER_RESTRICTED',
    PROMOTION_INVALID: 'PROMOTION_INVALID',
    
    // Escrow errors
    ESCROW_NOT_ACTIVE: 'ESCROW_NOT_ACTIVE',
    ESCROW_ALREADY_RELEASED: 'ESCROW_ALREADY_RELEASED',
    ESCROW_RELEASE_NOT_ALLOWED: 'ESCROW_RELEASE_NOT_ALLOWED',
    
    // Shipping errors
    INVALID_SHIPPING_ADDRESS: 'INVALID_SHIPPING_ADDRESS',
    SHIPPING_METHOD_UNAVAILABLE: 'SHIPPING_METHOD_UNAVAILABLE',
    TRACKING_NUMBER_INVALID: 'TRACKING_NUMBER_INVALID',
    
    // Return/Refund errors
    RETURN_WINDOW_EXPIRED: 'RETURN_WINDOW_EXPIRED',
    RETURN_NOT_ELIGIBLE: 'RETURN_NOT_ELIGIBLE',
    REFUND_AMOUNT_INVALID: 'REFUND_AMOUNT_INVALID',
    REFUND_PROCESSING_FAILED: 'REFUND_PROCESSING_FAILED'
  };
  
  // ================================
  // VALIDATION RULES
  // ================================
  
  const VALIDATION_RULES = {
    TRANSACTION: {
      MIN_AMOUNT: 1.00,
      MAX_AMOUNT: 999999.99,
      MAX_DESCRIPTION_LENGTH: 2000,
      MAX_NOTES_LENGTH: 1000
    },
    SHIPPING: {
      MAX_TRACKING_NUMBER_LENGTH: 50,
      MAX_CARRIER_NAME_LENGTH: 30,
      MAX_SHIPPING_NOTES_LENGTH: 500
    },
    DISPUTE: {
      MIN_DESCRIPTION_LENGTH: 50,
      MAX_DESCRIPTION_LENGTH: 2000,
      MAX_EVIDENCE_FILES: 15,
      MAX_EVIDENCE_FILE_SIZE: 10 * 1024 * 1024 // 10MB
    },
    RETURN: {
      MIN_REASON_LENGTH: 20,
      MAX_REASON_LENGTH: 1000,
      MAX_EVIDENCE_FILES: 10,
      RETURN_WINDOW_DAYS: 30
    }
  };
  
  // ================================
  // WEBHOOK EVENTS
  // ================================
  
  const WEBHOOK_EVENTS = {
    TRANSACTION_CREATED: 'transaction.created',
    TRANSACTION_UPDATED: 'transaction.updated',
    PAYMENT_SUCCEEDED: 'payment.succeeded',
    PAYMENT_FAILED: 'payment.failed',
    ESCROW_RELEASED: 'escrow.released',
    DISPUTE_CREATED: 'dispute.created',
    REFUND_PROCESSED: 'refund.processed',
    SHIPPING_UPDATED: 'shipping.updated'
  };
  
  // ================================
  // EXPORTS
  // ================================
  
  module.exports = {
    // Status and transitions
    TRANSACTION_STATUS,
    TRANSACTION_STATUS_TRANSITIONS,
    
    // Payment related
    PAYMENT_METHOD,
    PAYMENT_STATUS,
    PAYMENT_PROCESSING_FEES,
    
    // Shipping and fulfillment
    SHIPPING_CARRIER,
    SHIPPING_STATUS,
    DELIVERY_METHOD,
    
    // Disputes and resolution
    DISPUTE_REASON,
    DISPUTE_STATUS,
    DISPUTE_RESOLUTION,
    
    // Refunds and returns
    REFUND_TYPE,
    REFUND_REASON,
    REFUND_STATUS,
    RETURN_REASON,
    RETURN_TYPE,
    RETURN_STATUS,
    ITEM_CONDITION,
    
    // Fees and calculations
    FEE_TYPE,
    FEE_CALCULATION_METHOD,
    PLATFORM_FEES,
    
    // Escrow management
    ESCROW_STATUS,
    ESCROW_RELEASE_TRIGGER,
    ESCROW_CONFIG,
    
    // Analytics
    ANALYTICS_METRICS,
    ANALYTICS_DIMENSIONS,
    ANALYTICS_TIME_PERIODS,
    
    // Events and notifications
    TRANSACTION_EVENTS,
    WEBHOOK_EVENTS,
    
    // Error handling
    TRANSACTION_ERROR_CODES,
    
    // Validation
    VALIDATION_RULES
  };