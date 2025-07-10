// apps/backend/src/routes/messageRoutes.js
// Complete message routes for real-time messaging

const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateMiddleware');
const { messageValidation } = require('../validators/messageValidator');

const {
  sendMessageEndpoint,
  getMessagesEndpoint,
  sendTypingIndicatorEndpoint,
  markMessagesAsReadEndpoint,
  deleteMessageEndpoint,
  editMessageEndpoint
} = require('../controllers/messageController');

const router = express.Router();

// All message routes require authentication
router.use(authenticate);

// ================================
// MESSAGE SENDING ROUTES
// ================================

/**
 * @route   POST /api/v1/messages
 * @desc    Send a message in a chat
 * @access  Private
 * @body    { chat_id, content, message_type?, metadata? }
 */
router.post('/',
  validateRequest(messageValidation.sendMessage),
  sendMessageEndpoint
);

// ================================
// MESSAGE RETRIEVAL ROUTES
// ================================

/**
 * @route   GET /api/v1/messages/:chatId
 * @desc    Get messages for a specific chat
 * @access  Private
 * @query   { page?, limit?, before_message_id? }
 */
router.get('/:chatId',
  validateRequest(messageValidation.getMessages),
  getMessagesEndpoint
);

// ================================
// REAL-TIME INTERACTION ROUTES
// ================================

/**
 * @route   POST /api/v1/messages/:chatId/typing
 * @desc    Send typing indicator
 * @access  Private
 * @body    { is_typing }
 */
router.post('/:chatId/typing',
  validateRequest(messageValidation.typingIndicator),
  sendTypingIndicatorEndpoint
);

/**
 * @route   POST /api/v1/messages/:chatId/read
 * @desc    Mark messages as read
 * @access  Private
 * @body    { message_ids }
 */
router.post('/:chatId/read',
  validateRequest(messageValidation.markAsRead),
  markMessagesAsReadEndpoint
);

// ================================
// MESSAGE MANAGEMENT ROUTES
// ================================

/**
 * @route   PUT /api/v1/messages/:messageId
 * @desc    Edit a message
 * @access  Private
 * @body    { content }
 */
router.put('/:messageId',
  validateRequest(messageValidation.editMessage),
  editMessageEndpoint
);

/**
 * @route   DELETE /api/v1/messages/:messageId
 * @desc    Delete a message (soft delete)
 * @access  Private
 */
router.delete('/:messageId',
  validateRequest(messageValidation.deleteMessage),
  deleteMessageEndpoint
);

module.exports = router;