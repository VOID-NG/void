// apps/backend/src/validators/messageValidator.js
// Validation schemas for message endpoints

const Joi = require('joi');
const { patterns } = require('../middleware/validateMiddleware');

// ================================
// MESSAGE SENDING VALIDATION
// ================================

const sendMessage = {
  body: Joi.object({
    chat_id: Joi.string()
      .pattern(patterns.objectId)
      .required()
      .messages({
        'string.empty': 'Chat ID is required',
        'string.pattern.base': 'Invalid chat ID format',
        'any.required': 'Chat ID is required'
      }),
    
    content: Joi.string()
      .trim()
      .when('message_type', {
        is: 'TEXT',
        then: Joi.string()
          .min(1)
          .max(5000)
          .required()
          .messages({
            'string.min': 'Message content cannot be empty',
            'string.max': 'Message content cannot exceed 5000 characters',
            'any.required': 'Content is required for text messages'
          }),
        otherwise: Joi.string()
          .max(2048)
          .messages({
            'string.max': 'Content cannot exceed 2048 characters'
          })
      }),
    
    message_type: Joi.string()
      .uppercase()
      .valid('TEXT', 'IMAGE')
      .default('TEXT')
      .messages({
        'any.only': 'Message type must be either TEXT or IMAGE'
      }),
    
    metadata: Joi.object()
      .optional()
      .messages({
        'object.base': 'Metadata must be a valid object'
      })
  }).required()
};

// ================================
// MESSAGE RETRIEVAL VALIDATION
// ================================

const getMessages = {
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
      .default(50)
      .messages({
        'number.integer': 'Limit must be an integer',
        'number.min': 'Limit must be at least 1',
        'number.max': 'Limit cannot exceed 100'
      }),
    
    before_message_id: Joi.string()
      .pattern(patterns.objectId)
      .optional()
      .messages({
        'string.pattern.base': 'Invalid message ID format'
      })
  })
};

// ================================
// REAL-TIME INTERACTION VALIDATION
// ================================

const typingIndicator = {
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
    is_typing: Joi.boolean()
      .required()
      .messages({
        'boolean.base': 'is_typing must be a boolean value',
        'any.required': 'is_typing is required'
      })
  }).required()
};

const markAsRead = {
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
    message_ids: Joi.array()
      .items(
        Joi.string()
          .pattern(patterns.objectId)
          .messages({
            'string.pattern.base': 'Invalid message ID format'
          })
      )
      .min(1)
      .max(50)
      .required()
      .messages({
        'array.min': 'At least one message ID is required',
        'array.max': 'Cannot mark more than 50 messages as read at once',
        'any.required': 'message_ids array is required'
      })
  }).required()
};

// ================================
// MESSAGE MANAGEMENT VALIDATION
// ================================

const editMessage = {
  params: Joi.object({
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
    content: Joi.string()
      .trim()
      .min(1)
      .max(5000)
      .required()
      .messages({
        'string.min': 'Message content cannot be empty',
        'string.max': 'Message content cannot exceed 5000 characters',
        'any.required': 'Content is required'
      })
  }).required()
};

const deleteMessage = {
  params: Joi.object({
    messageId: Joi.string()
      .pattern(patterns.objectId)
      .required()
      .messages({
        'string.empty': 'Message ID is required',
        'string.pattern.base': 'Invalid message ID format',
        'any.required': 'Message ID is required'
      })
  }).required()
};

module.exports = {
  sendMessage,
  getMessages,
  typingIndicator,
  markAsRead,
  editMessage,
  deleteMessage
};