// apps/backend/src/validators/chatValidator.js
// Validation schemas for chat endpoints

const Joi = require('joi');
const { patterns } = require('../middleware/validateMiddleware');

// ================================
// CHAT CREATION VALIDATION
// ================================

const createProductChat = {
  body: Joi.object({
    listing_id: Joi.string()
      .pattern(patterns.objectId)
      .required()
      .messages({
        'string.empty': 'Product listing ID is required',
        'string.pattern.base': 'Invalid listing ID format',
        'any.required': 'Product listing ID is required'
      }),
    
    initial_message: Joi.string()
      .trim()
      .min(1)
      .max(1000)
      .optional()
      .messages({
        'string.min': 'Initial message cannot be empty',
        'string.max': 'Initial message cannot exceed 1000 characters'
      })
  }).required()
};

const createVendorChat = {
  body: Joi.object({
    vendor_id: Joi.string()
      .pattern(patterns.objectId)
      .required()
      .messages({
        'string.empty': 'Vendor ID is required',
        'string.pattern.base': 'Invalid vendor ID format',
        'any.required': 'Vendor ID is required'
      }),
    
    initial_message: Joi.string()
      .trim()
      .min(1)
      .max(1000)
      .optional()
      .messages({
        'string.min': 'Initial message cannot be empty',
        'string.max': 'Initial message cannot exceed 1000 characters'
      })
  }).required()
};

// ================================
// CHAT MANAGEMENT VALIDATION
// ================================

const getUserChats = {
  query: Joi.object({
    page: Joi.number()
      .integer()
      .min(1)
      .default(1)
      .messages({
        'number.integer': 'Page must be an integer',
        'number.min': 'Page must be at least 1'
      }),
    
    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .default(20)
      .messages({
        'number.integer': 'Limit must be an integer',
        'number.min': 'Limit must be at least 1',
        'number.max': 'Limit cannot exceed 100'
      }),
    
    status: Joi.string()
      .uppercase()
      .valid('ACTIVE', 'ARCHIVED', 'BLOCKED')
      .default('ACTIVE')
      .messages({
        'any.only': 'Status must be one of: ACTIVE, ARCHIVED, BLOCKED'
      })
  })
};

const getChatDetails = {
  params: Joi.object({
    chatId: Joi.string()
      .pattern(patterns.objectId)
      .required()
      .messages({
        'string.empty': 'Chat ID is required',
        'string.pattern.base': 'Invalid chat ID format',
        'any.required': 'Chat ID is required'
      })
  }).required()
};

const updateChatStatus = {
  params: Joi.object({
    chatId: Joi.string()
      .pattern(patterns.objectId)
      .required()
      .messages({
        'string.empty': 'Chat ID is required',
        'string.pattern.base': 'Invalid chat ID format',
        'any.required': 'Chat ID is required'
      })
  }).required(),
  
  body: Joi.object({
    status: Joi.string()
      .uppercase()
      .valid('ACTIVE', 'ARCHIVED', 'BLOCKED')
      .required()
      .messages({
        'any.only': 'Status must be one of: ACTIVE, ARCHIVED, BLOCKED',
        'any.required': 'Status is required'
      })
  }).required()
};

// ================================
// OFFER VALIDATION
// ================================

const makeOffer = {
  params: Joi.object({
    chatId: Joi.string()
      .pattern(patterns.objectId)
      .required()
      .messages({
        'string.empty': 'Chat ID is required',
        'string.pattern.base': 'Invalid chat ID format',
        'any.required': 'Chat ID is required'
      })
  }).required(),
  
  body: Joi.object({
    offer_amount: Joi.number()
      .positive()
      .precision(2)
      .required()
      .messages({
        'number.positive': 'Offer amount must be positive',
        'number.precision': 'Offer amount can have at most 2 decimal places',
        'any.required': 'Offer amount is required'
      }),
    
    message_type: Joi.string()
      .uppercase()
      .valid('OFFER', 'COUNTER_OFFER')
      .default('OFFER')
      .messages({
        'any.only': 'Message type must be either OFFER or COUNTER_OFFER'
      }),
    
    notes: Joi.string()
      .trim()
      .max(500)
      .default('')
      .messages({
        'string.max': 'Notes cannot exceed 500 characters'
      })
  }).required()
};

const respondToOffer = {
  params: Joi.object({
    chatId: Joi.string()
      .pattern(patterns.objectId)
      .required()
      .messages({
        'string.empty': 'Chat ID is required',
        'string.pattern.base': 'Invalid chat ID format',
        'any.required': 'Chat ID is required'
      }),
    
    messageId: Joi.string()
      .pattern(patterns.objectId)
      .required()
      .messages({
        'string.empty': 'Message ID is required',
        'string.pattern.base': 'Invalid message ID format',
        'any.required': 'Message ID is required'
      })
  }).required(),
  
  body: Joi.object({
    response: Joi.string()
      .uppercase()
      .valid('ACCEPT', 'REJECT')
      .required()
      .messages({
        'any.only': 'Response must be either ACCEPT or REJECT',
        'any.required': 'Response is required'
      }),
    
    notes: Joi.string()
      .trim()
      .max(500)
      .default('')
      .messages({
        'string.max': 'Notes cannot exceed 500 characters'
      })
  }).required()
};

// ================================
// UTILITY VALIDATION
// ================================

const searchMessages = {
  query: Joi.object({
    q: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .required()
      .messages({
        'string.min': 'Search query must be at least 2 characters long',
        'string.max': 'Search query cannot exceed 100 characters',
        'any.required': 'Search query is required'
      }),
    
    limit: Joi.number()
      .integer()
      .min(1)
      .max(50)
      .default(20)
      .messages({
        'number.integer': 'Limit must be an integer',
        'number.min': 'Limit must be at least 1',
        'number.max': 'Limit cannot exceed 50'
      }),
    
    chat_id: Joi.string()
      .pattern(patterns.objectId)
      .optional()
      .messages({
        'string.pattern.base': 'Invalid chat ID format'
      })
  })
};

module.exports = {
  createProductChat,
  createVendorChat,
  getUserChats,
  getChatDetails,
  updateChatStatus,
  makeOffer,
  respondToOffer,
  searchMessages
};