// apps/backend/src/validators/transactionValidator.js
// Comprehensive transaction validation schemas

const Joi = require('joi');

// ================================
// COMMON PATTERNS
// ================================

const objectIdPattern = /^[a-zA-Z0-9_-]{21}$/; // Prisma cuid pattern
const currencyAmountPattern = /^\d+(\.\d{1,2})?$/; // Currency with 2 decimal places

const commonSchemas = {
  objectId: Joi.string().pattern(objectIdPattern).required(),
  amount: Joi.number().positive().precision(2).max(999999.99).required(),
  optionalAmount: Joi.number().positive().precision(2).max(999999.99).optional(),
  address: Joi.object({
    street: Joi.string().max(100).required(),
    city: Joi.string().max(50).required(),
    state: Joi.string().max(50).required(),
    postal_code: Joi.string().max(20).required(),
    country: Joi.string().length(2).uppercase().required(),
    apartment: Joi.string().max(50).optional()
  }).required()
};

// ================================
// TRANSACTION CREATION
// ================================

const createTransactionSchema = {
  body: Joi.object({
    listing_id: commonSchemas.objectId.messages({
      'string.pattern.base': 'Invalid listing ID format',
      'any.required': 'Listing ID is required'
    }),
    
    vendor_id: commonSchemas.objectId.messages({
      'string.pattern.base': 'Invalid vendor ID format',
      'any.required': 'Vendor ID is required'
    }),
    
    amount: commonSchemas.amount.messages({
      'number.positive': 'Amount must be positive',
      'number.max': 'Amount cannot exceed $999,999.99',
      'any.required': 'Amount is required'
    }),
    
    payment_method_id: Joi.string().min(1).max(100).required().messages({
      'string.empty': 'Payment method ID is required',
      'string.max': 'Payment method ID is too long'
    }),
    
    shipping_address: commonSchemas.address.messages({
      'any.required': 'Shipping address is required'
    }),
    
    promotion_code: Joi.string().alphanum().uppercase().min(3).max(20).optional().messages({
      'string.alphanum': 'Promotion code must contain only letters and numbers',
      'string.min': 'Promotion code must be at least 3 characters',
      'string.max': 'Promotion code cannot exceed 20 characters'
    }),
    
    notes: Joi.string().max(500).optional().messages({
      'string.max': 'Notes cannot exceed 500 characters'
    })
  }).required()
};

// ================================
// PAYMENT PROCESSING
// ================================

const processPaymentSchema = {
  body: Joi.object({
    payment_method_id: Joi.string().min(1).max(100).required().messages({
      'string.empty': 'Payment method ID is required',
      'string.max': 'Payment method ID is too long'
    }),
    
    billing_address: Joi.object({
      street: Joi.string().max(100).required(),
      city: Joi.string().max(50).required(),
      state: Joi.string().max(50).required(),
      postal_code: Joi.string().max(20).required(),
      country: Joi.string().length(2).uppercase().required()
    }).optional(),
    
    save_payment_method: Joi.boolean().default(false),
    
    confirm_amount: commonSchemas.optionalAmount.messages({
      'number.positive': 'Confirmation amount must be positive',
      'number.max': 'Amount cannot exceed $999,999.99'
    })
  }).required(),
  
  params: Joi.object({
    transactionId: commonSchemas.objectId.messages({
      'string.pattern.base': 'Invalid transaction ID format'
    })
  }).required()
};

// ================================
// SHIPPING & FULFILLMENT
// ================================

const updateShippingSchema = {
  body: Joi.object({
    tracking_number: Joi.string().alphanum().min(5).max(50).optional().messages({
      'string.alphanum': 'Tracking number must contain only letters and numbers',
      'string.min': 'Tracking number must be at least 5 characters',
      'string.max': 'Tracking number cannot exceed 50 characters'
    }),
    
    shipping_carrier: Joi.string().valid(
      'ups', 'fedex', 'usps', 'dhl', 'other'
    ).optional().messages({
      'any.only': 'Shipping carrier must be one of: ups, fedex, usps, dhl, other'
    }),
    
    estimated_delivery: Joi.date().greater('now').optional().messages({
      'date.greater': 'Estimated delivery must be in the future'
    }),
    
    shipping_notes: Joi.string().max(500).optional().messages({
      'string.max': 'Shipping notes cannot exceed 500 characters'
    }),
    
    shipping_cost: commonSchemas.optionalAmount.messages({
      'number.positive': 'Shipping cost must be positive',
      'number.max': 'Shipping cost cannot exceed $999,999.99'
    }),
    
    require_signature: Joi.boolean().default(false)
  }).min(1).messages({
    'object.min': 'At least one shipping field must be provided'
  }),
  
  params: Joi.object({
    transactionId: commonSchemas.objectId
  })
};

const confirmDeliverySchema = {
  body: Joi.object({
    delivery_notes: Joi.string().max(1000).optional().messages({
      'string.max': 'Delivery notes cannot exceed 1000 characters'
    }),
    
    delivery_rating: Joi.number().integer().min(1).max(5).optional().messages({
      'number.min': 'Delivery rating must be at least 1',
      'number.max': 'Delivery rating cannot exceed 5',
      'number.integer': 'Delivery rating must be a whole number'
    }),
    
    delivery_photos: Joi.array().items(
      Joi.string().uri().messages({
        'string.uri': 'Delivery photo must be a valid URL'
      })
    ).max(5).optional().messages({
      'array.max': 'Cannot upload more than 5 delivery photos'
    }),
    
    condition_issues: Joi.boolean().default(false),
    
    condition_description: Joi.when('condition_issues', {
      is: true,
      then: Joi.string().min(10).max(1000).required().messages({
        'string.min': 'Condition description must be at least 10 characters when issues are reported',
        'string.max': 'Condition description cannot exceed 1000 characters',
        'any.required': 'Condition description is required when issues are reported'
      }),
      otherwise: Joi.string().max(1000).optional()
    })
  }),
  
  params: Joi.object({
    transactionId: commonSchemas.objectId
  })
};

// ================================
// REFUNDS & RETURNS
// ================================

const processRefundSchema = {
  body: Joi.object({
    refund_amount: commonSchemas.optionalAmount.messages({
      'number.positive': 'Refund amount must be positive',
      'number.max': 'Refund amount cannot exceed $999,999.99'
    }),
    
    refund_reason: Joi.string().valid(
      'buyer_request', 'defective_item', 'not_as_described', 
      'shipping_damage', 'vendor_error', 'admin_decision', 'dispute_resolution'
    ).required().messages({
      'any.only': 'Invalid refund reason',
      'any.required': 'Refund reason is required'
    }),
    
    refund_type: Joi.string().valid('full', 'partial').default('full').messages({
      'any.only': 'Refund type must be either full or partial'
    }),
    
    admin_notes: Joi.string().max(1000).optional().messages({
      'string.max': 'Admin notes cannot exceed 1000 characters'
    }),
    
    notify_parties: Joi.boolean().default(true),
    
    process_immediately: Joi.boolean().default(false)
  }).required(),
  
  params: Joi.object({
    transactionId: commonSchemas.objectId
  })
};

const initiateReturnSchema = {
  body: Joi.object({
    return_reason: Joi.string().valid(
      'defective', 'not_as_described', 'wrong_item', 'damaged_shipping', 
      'changed_mind', 'sizing_issue', 'quality_issue'
    ).required().messages({
      'any.only': 'Invalid return reason',
      'any.required': 'Return reason is required'
    }),
    
    return_description: Joi.string().min(20).max(1000).required().messages({
      'string.min': 'Return description must be at least 20 characters',
      'string.max': 'Return description cannot exceed 1000 characters',
      'any.required': 'Return description is required'
    }),
    
    return_type: Joi.string().valid(
      'defective', 'not_as_described', 'changed_mind', 'damaged'
    ).default('defective').messages({
      'any.only': 'Invalid return type'
    }),
    
    evidence_urls: Joi.array().items(
      Joi.string().uri().messages({
        'string.uri': 'Evidence URL must be valid'
      })
    ).max(10).optional().messages({
      'array.max': 'Cannot provide more than 10 evidence files'
    }),
    
    preferred_resolution: Joi.string().valid(
      'refund', 'exchange', 'store_credit'
    ).default('refund').messages({
      'any.only': 'Preferred resolution must be refund, exchange, or store_credit'
    }),
    
    item_condition: Joi.string().valid(
      'unopened', 'opened_unused', 'lightly_used', 'heavily_used', 'damaged'
    ).required().messages({
      'any.only': 'Invalid item condition',
      'any.required': 'Item condition is required'
    })
  }).required(),
  
  params: Joi.object({
    transactionId: commonSchemas.objectId
  })
};

// ================================
// DISPUTE HANDLING
// ================================

const initiateDisputeSchema = {
  body: Joi.object({
    reason: Joi.string().valid(
      'item_not_received', 'item_defective', 'not_as_described', 
      'unauthorized_charge', 'billing_issue', 'refund_not_processed',
      'vendor_unresponsive', 'delivery_issue'
    ).required().messages({
      'any.only': 'Invalid dispute reason',
      'any.required': 'Dispute reason is required'
    }),
    
    description: Joi.string().min(50).max(2000).required().messages({
      'string.min': 'Dispute description must be at least 50 characters',
      'string.max': 'Dispute description cannot exceed 2000 characters',
      'any.required': 'Dispute description is required'
    }),
    
    evidence_urls: Joi.array().items(
      Joi.string().uri().messages({
        'string.uri': 'Evidence URL must be valid'
      })
    ).max(15).optional().messages({
      'array.max': 'Cannot provide more than 15 evidence files'
    }),
    
    requested_resolution: Joi.string().valid(
      'full_refund', 'partial_refund', 'replacement', 'store_credit', 'other'
    ).required().messages({
      'any.only': 'Invalid requested resolution',
      'any.required': 'Requested resolution is required'
    }),
    
    resolution_amount: Joi.when('requested_resolution', {
      is: Joi.string().valid('partial_refund', 'store_credit'),
      then: commonSchemas.amount.messages({
        'any.required': 'Resolution amount is required for partial refunds and store credit'
      }),
      otherwise: commonSchemas.optionalAmount
    }),
    
    communication_attempts: Joi.array().items(
      Joi.object({
        date: Joi.date().required(),
        method: Joi.string().valid('email', 'chat', 'phone', 'platform_message').required(),
        description: Joi.string().max(500).required()
      })
    ).max(10).optional().messages({
      'array.max': 'Cannot log more than 10 communication attempts'
    }),
    
    urgency_level: Joi.string().valid('low', 'medium', 'high', 'urgent').default('medium')
  }).required(),
  
  params: Joi.object({
    transactionId: commonSchemas.objectId
  })
};

// ================================
// STATUS UPDATES
// ================================

const updateStatusSchema = {
  body: Joi.object({
    status: Joi.string().valid(
      'INITIATED', 'PAYMENT_PENDING', 'ESCROW', 'SHIPPED', 'DELIVERED',
      'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'FAILED'
    ).required().messages({
      'any.only': 'Invalid transaction status',
      'any.required': 'Status is required'
    }),
    
    reason: Joi.string().max(500).optional().messages({
      'string.max': 'Reason cannot exceed 500 characters'
    }),
    
    admin_notes: Joi.string().max(1000).optional().messages({
      'string.max': 'Admin notes cannot exceed 1000 characters'
    }),
    
    notify_parties: Joi.boolean().default(true),
    
    force_update: Joi.boolean().default(false) // Admin override for invalid transitions
  }).required(),
  
  params: Joi.object({
    transactionId: commonSchemas.objectId
  })
};

// ================================
// ANALYTICS & REPORTING
// ================================

const analyticsQuerySchema = {
  query: Joi.object({
    start_date: Joi.date().iso().optional().messages({
      'date.format': 'Start date must be in ISO format (YYYY-MM-DD)'
    }),
    
    end_date: Joi.date().iso().min(Joi.ref('start_date')).optional().messages({
      'date.format': 'End date must be in ISO format (YYYY-MM-DD)',
      'date.min': 'End date must be after start date'
    }),
    
    vendor_id: Joi.string().pattern(objectIdPattern).optional().messages({
      'string.pattern.base': 'Invalid vendor ID format'
    }),
    
    status_filter: Joi.string().valid(
      'INITIATED', 'PAYMENT_PENDING', 'ESCROW', 'SHIPPED', 'DELIVERED',
      'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'FAILED'
    ).optional(),
    
    category_id: Joi.string().pattern(objectIdPattern).optional().messages({
      'string.pattern.base': 'Invalid category ID format'
    }),
    
    min_amount: commonSchemas.optionalAmount,
    
    max_amount: Joi.number().positive().precision(2).min(Joi.ref('min_amount')).optional().messages({
      'number.min': 'Maximum amount must be greater than minimum amount'
    }),
    
    group_by: Joi.string().valid(
      'day', 'week', 'month', 'status', 'vendor', 'category'
    ).default('day'),
    
    include_refunds: Joi.boolean().default(true),
    
    currency: Joi.string().length(3).uppercase().default('USD').messages({
      'string.length': 'Currency must be a 3-letter code',
      'string.uppercase': 'Currency must be uppercase'
    })
  })
};

const reportQuerySchema = {
  query: Joi.object({
    start_date: Joi.date().iso().required().messages({
      'date.format': 'Start date must be in ISO format (YYYY-MM-DD)',
      'any.required': 'Start date is required'
    }),
    
    end_date: Joi.date().iso().min(Joi.ref('start_date')).required().messages({
      'date.format': 'End date must be in ISO format (YYYY-MM-DD)',
      'date.min': 'End date must be after start date',
      'any.required': 'End date is required'
    }),
    
    vendor_id: Joi.string().pattern(objectIdPattern).optional(),
    
    status_filter: Joi.string().valid(
      'INITIATED', 'PAYMENT_PENDING', 'ESCROW', 'SHIPPED', 'DELIVERED',
      'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'FAILED'
    ).optional(),
    
    category_id: Joi.string().pattern(objectIdPattern).optional(),
    
    include_details: Joi.boolean().default(false),
    
    format: Joi.string().valid('json', 'csv', 'pdf').default('json'),
    
    email_report: Joi.boolean().default(false),
    
    email_recipients: Joi.when('email_report', {
      is: true,
      then: Joi.array().items(
        Joi.string().email().messages({
          'string.email': 'Invalid email address'
        })
      ).min(1).max(10).required().messages({
        'array.min': 'At least one email recipient is required',
        'array.max': 'Cannot send to more than 10 recipients',
        'any.required': 'Email recipients are required when email_report is true'
      }),
      otherwise: Joi.array().items(Joi.string().email()).max(10).optional()
    })
  })
};

// ================================
// WEBHOOK VALIDATION
// ================================

const webhookSchema = {
  headers: Joi.object({
    'stripe-signature': Joi.string().required().messages({
      'any.required': 'Stripe signature header is required'
    })
  }).unknown(true), // Allow other headers
  
  body: Joi.any().required() // Raw body for signature verification
};

// ================================
// BULK OPERATIONS
// ================================

const bulkUpdateSchema = {
  body: Joi.object({
    transaction_ids: Joi.array().items(
      commonSchemas.objectId
    ).min(1).max(100).unique().required().messages({
      'array.min': 'At least one transaction ID is required',
      'array.max': 'Cannot update more than 100 transactions at once',
      'array.unique': 'Transaction IDs must be unique',
      'any.required': 'Transaction IDs are required'
    }),
    
    action: Joi.string().valid(
      'cancel', 'release_escrow', 'mark_shipped', 'mark_delivered', 'refund'
    ).required().messages({
      'any.only': 'Invalid bulk action',
      'any.required': 'Bulk action is required'
    }),
    
    reason: Joi.string().max(500).required().messages({
      'string.max': 'Reason cannot exceed 500 characters',
      'any.required': 'Reason is required for bulk operations'
    }),
    
    admin_notes: Joi.string().max(1000).optional(),
    
    notify_parties: Joi.boolean().default(true),
    
    confirm_bulk_action: Joi.boolean().valid(true).required().messages({
      'any.only': 'Bulk action confirmation is required',
      'any.required': 'Must confirm bulk action'
    })
  }).required()
};

// ================================
// TRANSACTION SEARCH
// ================================

const searchTransactionsSchema = {
  query: Joi.object({
    q: Joi.string().min(1).max(100).optional().messages({
      'string.min': 'Search query cannot be empty',
      'string.max': 'Search query cannot exceed 100 characters'
    }),
    
    status: Joi.array().items(
      Joi.string().valid(
        'INITIATED', 'PAYMENT_PENDING', 'ESCROW', 'SHIPPED', 'DELIVERED',
        'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'FAILED'
      )
    ).max(5).optional().messages({
      'array.max': 'Cannot filter by more than 5 statuses'
    }),
    
    date_range: Joi.string().valid(
      'today', 'yesterday', 'last_7_days', 'last_30_days', 
      'last_90_days', 'last_year', 'custom'
    ).default('last_30_days'),
    
    start_date: Joi.when('date_range', {
      is: 'custom',
      then: Joi.date().iso().required(),
      otherwise: Joi.date().iso().optional()
    }),
    
    end_date: Joi.when('date_range', {
      is: 'custom',
      then: Joi.date().iso().min(Joi.ref('start_date')).required(),
      otherwise: Joi.date().iso().optional()
    }),
    
    amount_min: commonSchemas.optionalAmount,
    
    amount_max: Joi.number().positive().precision(2).min(Joi.ref('amount_min')).optional(),
    
    vendor_id: Joi.string().pattern(objectIdPattern).optional(),
    
    buyer_id: Joi.string().pattern(objectIdPattern).optional(),
    
    listing_id: Joi.string().pattern(objectIdPattern).optional(),
    
    has_dispute: Joi.boolean().optional(),
    
    has_refund: Joi.boolean().optional(),
    
    payment_method: Joi.string().valid(
      'stripe', 'paypal', 'apple_pay', 'google_pay', 'bank_transfer'
    ).optional(),
    
    sort_by: Joi.string().valid(
      'created_at', 'amount', 'status', 'updated_at'
    ).default('created_at'),
    
    sort_order: Joi.string().valid('asc', 'desc').default('desc'),
    
    page: Joi.number().integer().min(1).max(1000).default(1).messages({
      'number.min': 'Page must be at least 1',
      'number.max': 'Page cannot exceed 1000'
    }),
    
    limit: Joi.number().integer().min(1).max(100).default(20).messages({
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit cannot exceed 100'
    }),
    
    include_related: Joi.boolean().default(false) // Include buyer, vendor, listing details
  })
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Core transaction operations
  createTransactionSchema,
  processPaymentSchema,
  updateStatusSchema,
  
  // Shipping & fulfillment
  updateShippingSchema,
  confirmDeliverySchema,
  
  // Refunds & returns
  processRefundSchema,
  initiateReturnSchema,
  
  // Dispute handling
  initiateDisputeSchema,
  
  // Analytics & reporting
  analyticsQuerySchema,
  reportQuerySchema,
  
  // Search & bulk operations
  searchTransactionsSchema,
  bulkUpdateSchema,
  
  // Webhook handling
  webhookSchema,
  
  // Common schemas for reuse
  commonSchemas
};