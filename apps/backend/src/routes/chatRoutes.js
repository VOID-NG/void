// apps/backend/src/routes/chatRoutes.js
// Complete chat routes with product-based and vendor-profile chat support

const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateMiddleware');
const { chatValidation } = require('../validators/chatValidator');

const {
  createProductChatEndpoint,
  createVendorChatEndpoint,
  getUserChatsEndpoint,
  getChatDetailsEndpoint,
  updateChatStatusEndpoint,
  makeOfferEndpoint,
  respondToOfferEndpoint,
  getUnreadCountEndpoint,
  searchMessagesEndpoint
} = require('../controllers/chatController');

const router = express.Router();

// All chat routes require authentication
router.use(authenticate);

// ================================
// CHAT CREATION ROUTES
// ================================

/**
 * @route   POST /api/v1/chat/product
 * @desc    Create or get product-based chat
 * @access  Private
 * @body    { listing_id, initial_message? }
 */
router.post('/product',
  validateRequest(chatValidation.createProductChat),
  createProductChatEndpoint
);

/**
 * @route   POST /api/v1/chat/vendor
 * @desc    Create or get vendor-profile chat
 * @access  Private
 * @body    { vendor_id, initial_message? }
 */
router.post('/vendor',
  validateRequest(chatValidation.createVendorChat),
  createVendorChatEndpoint
);

// ================================
// CHAT MANAGEMENT ROUTES
// ================================

/**
 * @route   GET /api/v1/chat
 * @desc    Get user's chats with pagination
 * @access  Private
 * @query   { page?, limit?, status? }
 */
router.get('/',
  validateRequest(chatValidation.getUserChats),
  getUserChatsEndpoint
);

/**
 * @route   GET /api/v1/chat/unread-count
 * @desc    Get unread message count for user
 * @access  Private
 */
router.get('/unread-count',
  getUnreadCountEndpoint
);

/**
 * @route   GET /api/v1/chat/search
 * @desc    Search messages across user's chats
 * @access  Private
 * @query   { q, limit?, chat_id? }
 */
router.get('/search',
  validateRequest(chatValidation.searchMessages),
  searchMessagesEndpoint
);

/**
 * @route   GET /api/v1/chat/:chatId
 * @desc    Get chat details
 * @access  Private
 */
router.get('/:chatId',
  validateRequest(chatValidation.getChatDetails),
  getChatDetailsEndpoint
);

/**
 * @route   PATCH /api/v1/chat/:chatId/status
 * @desc    Update chat status (archive, block, reactivate)
 * @access  Private
 * @body    { status }
 */
router.patch('/:chatId/status',
  validateRequest(chatValidation.updateChatStatus),
  updateChatStatusEndpoint
);

// ================================
// OFFER MANAGEMENT ROUTES
// ================================

/**
 * @route   POST /api/v1/chat/:chatId/offer
 * @desc    Make an offer in a chat
 * @access  Private
 * @body    { offer_amount, message_type?, notes? }
 */
router.post('/:chatId/offer',
  validateRequest(chatValidation.makeOffer),
  makeOfferEndpoint
);

/**
 * @route   POST /api/v1/chat/:chatId/offer/:messageId/respond
 * @desc    Respond to an offer (accept/reject)
 * @access  Private
 * @body    { response, notes? }
 */
router.post('/:chatId/offer/:messageId/respond',
  validateRequest(chatValidation.respondToOffer),
  respondToOfferEndpoint
);

module.exports = router;