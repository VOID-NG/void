// apps/backend/src/controllers/chatController.js
// Complete chat controller with product-based and vendor-profile chat support

const {
    createProductChat,
    createVendorChat,
    getUserChats,
    getChatDetails,
    updateChatStatus
  } = require('../services/chatService');
  
  const {
    sendMessageRealtime,
    createOfferMessage,
    handleOfferResponse,
    getUnreadMessageCount,
    searchMessages
  } = require('../services/messageService');
  
  const logger = require('../utils/logger');
  const { ValidationError } = require('../middleware/errorMiddleware');
  
  // ================================
  // CHAT CREATION ENDPOINTS
  // ================================
  
  /**
   * @route   POST /api/v1/chat/product
   * @desc    Create or get product-based chat
   * @access  Private
   * @body    { listing_id, initial_message? }
   */
  const createProductChatEndpoint = async (req, res) => {
    try {
      const { listing_id, initial_message } = req.body;
      const buyerId = req.user.id;
  
      if (!listing_id) {
        throw new ValidationError('Product listing ID is required');
      }
  
      // Create or get existing product chat
      const result = await createProductChat(listing_id, buyerId, initial_message);
  
      // Get Socket.IO instance for real-time updates
      const io = req.app.get('io');
  
      // If this is a new chat, notify the vendor
      if (result.isNew && io) {
        const vendorId = result.chat.vendor.id;
        
        io.to(`user_${vendorId}`).emit('new_chat_created', {
          chat: result.chat,
          chat_type: 'product',
          message: initial_message ? 'New message about your product' : 'Someone is interested in your product',
          product: result.chat.listing
        });
      }
  
      res.status(result.isNew ? 201 : 200).json({
        success: true,
        data: {
          chat: result.chat,
          is_new_chat: result.isNew,
          chat_type: 'product'
        },
        message: result.isNew ? 'Product chat created successfully' : 'Existing product chat retrieved'
      });
  
    } catch (error) {
      logger.error('Product chat creation failed:', error);
      
      if (error.message.includes('not found') || error.message.includes('not available')) {
        return res.status(404).json({
          success: false,
          error: error.message
        });
      }
  
      if (error.message.includes('own product')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to create product chat',
        message: error.message
      });
    }
  };
  
  /**
   * @route   POST /api/v1/chat/vendor
   * @desc    Create or get vendor-profile chat
   * @access  Private
   * @body    { vendor_id, initial_message? }
   */
  const createVendorChatEndpoint = async (req, res) => {
    try {
      const { vendor_id, initial_message } = req.body;
      const buyerId = req.user.id;
  
      if (!vendor_id) {
        throw new ValidationError('Vendor ID is required');
      }
  
      // Create or get existing vendor chat
      const result = await createVendorChat(vendor_id, buyerId, initial_message);
  
      // Get Socket.IO instance for real-time updates
      const io = req.app.get('io');
  
      // If this is a new chat, notify the vendor
      if (result.isNew && io) {
        io.to(`user_${vendor_id}`).emit('new_chat_created', {
          chat: result.chat,
          chat_type: 'vendor',
          message: initial_message || 'Someone wants to chat with you',
          product: null
        });
      }
  
      res.status(result.isNew ? 201 : 200).json({
        success: true,
        data: {
          chat: result.chat,
          is_new_chat: result.isNew,
          chat_type: 'vendor'
        },
        message: result.isNew ? 'Vendor chat created successfully' : 'Existing vendor chat retrieved'
      });
  
    } catch (error) {
      logger.error('Vendor chat creation failed:', error);
      
      if (error.message.includes('not found') || error.message.includes('not available')) {
        return res.status(404).json({
          success: false,
          error: error.message
        });
      }
  
      if (error.message.includes('not a vendor') || error.message.includes('yourself')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to create vendor chat',
        message: error.message
      });
    }
  };
  
  // ================================
  // CHAT MANAGEMENT ENDPOINTS
  // ================================
  
  /**
   * @route   GET /api/v1/chat
   * @desc    Get user's chats with pagination
   * @access  Private
   * @query   { page?, limit?, status? }
   */
  const getUserChatsEndpoint = async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        status = 'ACTIVE'
      } = req.query;
  
      const userId = req.user.id;
  
      // Validate status
      const validStatuses = ['ACTIVE', 'ARCHIVED', 'BLOCKED'];
      if (!validStatuses.includes(status.toUpperCase())) {
        throw new ValidationError('Invalid chat status', { 
          valid_statuses: validStatuses 
        });
      }
  
      // Get user's chats
      const chats = await getUserChats(userId, {
        page: parseInt(page),
        limit: parseInt(limit),
        status: status.toUpperCase()
      });
  
      // Get total unread count
      const totalUnreadCount = await getUnreadMessageCount(userId);
  
      res.json({
        success: true,
        data: {
          chats,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total_chats: chats.length,
            has_more: chats.length === parseInt(limit)
          },
          unread_summary: {
            total_unread_messages: totalUnreadCount,
            chats_with_unread: chats.filter(chat => chat.unreadCount > 0).length
          }
        }
      });
  
    } catch (error) {
      logger.error('Get user chats failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get chats',
        message: error.message
      });
    }
  };
  
  /**
   * @route   GET /api/v1/chat/:chatId
   * @desc    Get chat details
   * @access  Private
   */
  const getChatDetailsEndpoint = async (req, res) => {
    try {
      const { chatId } = req.params;
      const userId = req.user.id;
  
      if (!chatId) {
        throw new ValidationError('Chat ID is required');
      }
  
      // Get chat details
      const chatDetails = await getChatDetails(chatId, userId);
  
      res.json({
        success: true,
        data: {
          chat: chatDetails
        }
      });
  
    } catch (error) {
      logger.error('Get chat details failed:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Chat not found'
        });
      }
  
      if (error.message.includes('Access denied')) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this chat'
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to get chat details',
        message: error.message
      });
    }
  };
  
  /**
   * @route   PATCH /api/v1/chat/:chatId/status
   * @desc    Update chat status (archive, block, reactivate)
   * @access  Private
   * @body    { status }
   */
  const updateChatStatusEndpoint = async (req, res) => {
    try {
      const { chatId } = req.params;
      const { status } = req.body;
      const userId = req.user.id;
  
      if (!chatId) {
        throw new ValidationError('Chat ID is required');
      }
  
      if (!status) {
        throw new ValidationError('Status is required');
      }
  
      // Update chat status
      const updatedChat = await updateChatStatus(chatId, userId, status.toUpperCase());
  
      // Send real-time update
      const io = req.app.get('io');
      if (io) {
        io.to(`chat_${chatId}`).emit('chat_status_updated', {
          chat_id: chatId,
          new_status: status.toUpperCase(),
          updated_by: userId,
          timestamp: new Date().toISOString()
        });
      }
  
      res.json({
        success: true,
        data: {
          chat: updatedChat
        },
        message: `Chat ${status.toLowerCase()} successfully`
      });
  
    } catch (error) {
      logger.error('Update chat status failed:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Chat not found'
        });
      }
  
      if (error.message.includes('Access denied')) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this chat'
        });
      }
  
      if (error.message.includes('Invalid')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to update chat status',
        message: error.message
      });
    }
  };
  
  // ================================
  // OFFER MANAGEMENT ENDPOINTS
  // ================================
  
  /**
   * @route   POST /api/v1/chat/:chatId/offer
   * @desc    Make an offer in a chat
   * @access  Private
   * @body    { offer_amount, message_type?, notes? }
   */
  const makeOfferEndpoint = async (req, res) => {
    try {
      const { chatId } = req.params;
      const { 
        offer_amount, 
        message_type = 'OFFER',
        notes = '' 
      } = req.body;
      const senderId = req.user.id;
  
      if (!chatId) {
        throw new ValidationError('Chat ID is required');
      }
  
      if (!offer_amount) {
        throw new ValidationError('Offer amount is required');
      }
  
      // Validate message type
      const validOfferTypes = ['OFFER', 'COUNTER_OFFER'];
      if (!validOfferTypes.includes(message_type)) {
        throw new ValidationError('Invalid offer type', {
          valid_types: validOfferTypes
        });
      }
  
      // Get Socket.IO instance
      const io = req.app.get('io');
  
      // Create offer message
      const offerMessage = await createOfferMessage({
        chatId,
        senderId,
        offerAmount: parseFloat(offer_amount),
        messageType: message_type,
        notes
      }, io);
  
      res.status(201).json({
        success: true,
        data: {
          message: offerMessage,
          offer_amount: parseFloat(offer_amount),
          message_type
        },
        message: 'Offer sent successfully'
      });
  
    } catch (error) {
      logger.error('Make offer failed:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Chat not found'
        });
      }
  
      if (error.message.includes('Access denied')) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this chat'
        });
      }
  
      if (error.message.includes('required') || error.message.includes('Invalid')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to make offer',
        message: error.message
      });
    }
  };
  
  /**
   * @route   POST /api/v1/chat/:chatId/offer/:messageId/respond
   * @desc    Respond to an offer (accept/reject)
   * @access  Private
   * @body    { response, notes? }
   */
  const respondToOfferEndpoint = async (req, res) => {
    try {
      const { chatId, messageId } = req.params;
      const { response, notes = '' } = req.body;
      const userId = req.user.id;
  
      if (!chatId || !messageId) {
        throw new ValidationError('Chat ID and Message ID are required');
      }
  
      if (!response) {
        throw new ValidationError('Response is required');
      }
  
      // Validate response
      const validResponses = ['ACCEPT', 'REJECT'];
      if (!validResponses.includes(response.toUpperCase())) {
        throw new ValidationError('Invalid response', {
          valid_responses: validResponses
        });
      }
  
      // Get Socket.IO instance
      const io = req.app.get('io');
  
      // Handle offer response
      const result = await handleOfferResponse({
        messageId,
        chatId,
        userId,
        response: response.toUpperCase(),
        notes
      }, io);
  
      const responseData = {
        success: true,
        data: {
          response_message: result.response_message,
          original_offer: result.original_offer,
          response_type: response.toUpperCase()
        },
        message: `Offer ${response.toLowerCase()} successfully`
      };
  
      // Add transaction info if offer was accepted
      if (result.action_required === 'create_transaction') {
        responseData.data.next_step = {
          action: 'create_transaction',
          offer_amount: result.original_offer.offer_amount,
          message: 'Offer accepted! Proceed to create transaction.'
        };
      }
  
      res.json(responseData);
  
    } catch (error) {
      logger.error('Respond to offer failed:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: error.message
        });
      }
  
      if (error.message.includes('Access denied')) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }
  
      if (error.message.includes('Invalid') || error.message.includes('not an offer')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to respond to offer',
        message: error.message
      });
    }
  };
  
  // ================================
  // UTILITY ENDPOINTS
  // ================================
  
  /**
   * @route   GET /api/v1/chat/unread-count
   * @desc    Get unread message count for user
   * @access  Private
   */
  const getUnreadCountEndpoint = async (req, res) => {
    try {
      const userId = req.user.id;
  
      const unreadCount = await getUnreadMessageCount(userId);
  
      res.json({
        success: true,
        data: {
          unread_count: unreadCount
        }
      });
  
    } catch (error) {
      logger.error('Get unread count failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get unread count',
        message: error.message
      });
    }
  };
  
  /**
   * @route   GET /api/v1/chat/search
   * @desc    Search messages across user's chats
   * @access  Private
   * @query   { q, limit?, chat_id? }
   */
  const searchMessagesEndpoint = async (req, res) => {
    try {
      const { q: searchQuery, limit = 20, chat_id } = req.query;
      const userId = req.user.id;
  
      if (!searchQuery || searchQuery.trim().length < 2) {
        throw new ValidationError('Search query must be at least 2 characters long');
      }
  
      const messages = await searchMessages(userId, searchQuery.trim(), {
        limit: parseInt(limit),
        chatId: chat_id || null
      });
  
      res.json({
        success: true,
        data: {
          query: searchQuery,
          messages,
          result_count: messages.length,
          search_scope: chat_id ? 'single_chat' : 'all_chats'
        }
      });
  
    } catch (error) {
      logger.error('Search messages failed:', error);
      
      if (error.message.includes('2 characters')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to search messages',
        message: error.message
      });
    }
  };
  
  module.exports = {
    // Chat creation
    createProductChatEndpoint,
    createVendorChatEndpoint,
    
    // Chat management
    getUserChatsEndpoint,
    getChatDetailsEndpoint,
    updateChatStatusEndpoint,
    
    // Offer management
    makeOfferEndpoint,
    respondToOfferEndpoint,
    
    // Utilities
    getUnreadCountEndpoint,
    searchMessagesEndpoint
  };