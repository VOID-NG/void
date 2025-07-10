// apps/backend/test/chat-test-utils.js
// Testing utilities for the chat and messaging system

const io = require('socket.io-client');
const axios = require('axios');

// ================================
// TEST CONFIGURATION
// ================================

const TEST_CONFIG = {
  API_BASE_URL: 'http://localhost:5000/api/v1',
  SOCKET_URL: 'http://localhost:5000',
  TEST_USERS: {
    buyer: {
      email: 'buyer@test.com',
      password: 'TestPass123!',
      username: 'testbuyer',
      role: 'USER'
    },
    vendor: {
      email: 'vendor@test.com', 
      password: 'TestPass123!',
      username: 'testvendor',
      role: 'VENDOR'
    }
  }
};

// ================================
// API TESTING UTILITIES
// ================================

class ChatAPITester {
  constructor() {
    this.tokens = {};
    this.users = {};
  }

  /**
   * Setup test users and get auth tokens
   */
  async setupTestUsers() {
    try {
      console.log('🔧 Setting up test users...');

      for (const [userType, userData] of Object.entries(TEST_CONFIG.TEST_USERS)) {
        // Try to login first
        try {
          const loginResponse = await axios.post(`${TEST_CONFIG.API_BASE_URL}/auth/login`, {
            email: userData.email,
            password: userData.password
          });

          this.tokens[userType] = loginResponse.data.data.tokens.access_token;
          this.users[userType] = loginResponse.data.data.user;
          
          console.log(`✅ ${userType} logged in successfully`);
        } catch (loginError) {
          // If login fails, register the user
          console.log(`📝 Registering ${userType}...`);
          
          const registerResponse = await axios.post(`${TEST_CONFIG.API_BASE_URL}/auth/register`, {
            ...userData,
            first_name: `Test ${userType}`,
            last_name: 'User'
          });

          this.tokens[userType] = registerResponse.data.data.tokens.access_token;
          this.users[userType] = registerResponse.data.data.user;
          
          console.log(`✅ ${userType} registered successfully`);
        }
      }

      console.log('✅ Test users setup complete');
      return { tokens: this.tokens, users: this.users };

    } catch (error) {
      console.error('❌ Test user setup failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create a test product listing
   */
  async createTestListing(vendorToken, listingData = {}) {
    try {
      const defaultListing = {
        title: 'Test iPhone 15 Pro',
        description: 'Like new iPhone 15 Pro for testing chat functionality',
        price: 999.99,
        condition: 'LIKE_NEW',
        category_id: 'test-category-id',
        quantity: 1,
        tags: ['iphone', 'smartphone', 'apple'],
        is_negotiable: true
      };

      const response = await axios.post(
        `${TEST_CONFIG.API_BASE_URL}/listings`,
        { ...defaultListing, ...listingData },
        {
          headers: { Authorization: `Bearer ${vendorToken}` }
        }
      );

      console.log('✅ Test listing created:', response.data.data.listing.title);
      return response.data.data.listing;

    } catch (error) {
      console.error('❌ Create test listing failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Test product-based chat creation
   */
  async testProductChatCreation(buyerToken, listingId, initialMessage = null) {
    try {
      console.log('💬 Testing product chat creation...');

      const response = await axios.post(
        `${TEST_CONFIG.API_BASE_URL}/chat/product`,
        {
          listing_id: listingId,
          initial_message: initialMessage
        },
        {
          headers: { Authorization: `Bearer ${buyerToken}` }
        }
      );

      console.log('✅ Product chat created:', {
        chatId: response.data.data.chat.id,
        chatType: response.data.data.chat_type,
        isNew: response.data.data.is_new_chat
      });

      return response.data.data.chat;

    } catch (error) {
      console.error('❌ Product chat creation failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Test vendor-profile chat creation
   */
  async testVendorChatCreation(buyerToken, vendorId, initialMessage = null) {
    try {
      console.log('💬 Testing vendor chat creation...');

      const response = await axios.post(
        `${TEST_CONFIG.API_BASE_URL}/chat/vendor`,
        {
          vendor_id: vendorId,
          initial_message: initialMessage
        },
        {
          headers: { Authorization: `Bearer ${buyerToken}` }
        }
      );

      console.log('✅ Vendor chat created:', {
        chatId: response.data.data.chat.id,
        chatType: response.data.data.chat_type,
        isNew: response.data.data.is_new_chat
      });

      return response.data.data.chat;

    } catch (error) {
      console.error('❌ Vendor chat creation failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Test sending messages via API
   */
  async testSendMessage(userToken, chatId, content, messageType = 'TEXT') {
    try {
      console.log(`📤 Sending ${messageType} message...`);

      const response = await axios.post(
        `${TEST_CONFIG.API_BASE_URL}/messages`,
        {
          chat_id: chatId,
          content,
          message_type: messageType
        },
        {
          headers: { Authorization: `Bearer ${userToken}` }
        }
      );

      console.log('✅ Message sent:', {
        messageId: response.data.data.message.id,
        content: response.data.data.message.content,
        type: response.data.data.message.type
      });

      return response.data.data.message;

    } catch (error) {
      console.error('❌ Send message failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Test making an offer
   */
  async testMakeOffer(userToken, chatId, offerAmount, notes = '') {
    try {
      console.log(`💰 Making offer: $${offerAmount}...`);

      const response = await axios.post(
        `${TEST_CONFIG.API_BASE_URL}/chat/${chatId}/offer`,
        {
          offer_amount: offerAmount,
          message_type: 'OFFER',
          notes
        },
        {
          headers: { Authorization: `Bearer ${userToken}` }
        }
      );

      console.log('✅ Offer made:', {
        messageId: response.data.data.message.id,
        offerAmount: response.data.data.offer_amount,
        messageType: response.data.data.message_type
      });

      return response.data.data.message;

    } catch (error) {
      console.error('❌ Make offer failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Test responding to an offer
   */
  async testRespondToOffer(userToken, chatId, messageId, response, notes = '') {
    try {
      console.log(`🎯 Responding to offer: ${response}...`);

      const responseData = await axios.post(
        `${TEST_CONFIG.API_BASE_URL}/chat/${chatId}/offer/${messageId}/respond`,
        {
          response,
          notes
        },
        {
          headers: { Authorization: `Bearer ${userToken}` }
        }
      );

      console.log('✅ Offer response sent:', {
        responseType: responseData.data.data.response_type,
        messageId: responseData.data.data.response_message.id
      });

      return responseData.data;

    } catch (error) {
      console.error('❌ Respond to offer failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Test getting user chats
   */
  async testGetUserChats(userToken) {
    try {
      console.log('📋 Getting user chats...');

      const response = await axios.get(
        `${TEST_CONFIG.API_BASE_URL}/chat`,
        {
          headers: { Authorization: `Bearer ${userToken}` }
        }
      );

      console.log('✅ User chats retrieved:', {
        chatCount: response.data.data.chats.length,
        unreadCount: response.data.data.unread_summary.total_unread_messages
      });

      return response.data.data.chats;

    } catch (error) {
      console.error('❌ Get user chats failed:', error.response?.data || error.message);
      throw error;
    }
  }
}

// ================================
// SOCKET.IO TESTING UTILITIES
// ================================

class ChatSocketTester {
  constructor() {
    this.sockets = {};
    this.eventLog = [];
  }

  /**
   * Connect user socket
   */
  async connectUserSocket(userId, userToken) {
    return new Promise((resolve, reject) => {
      const socket = io(TEST_CONFIG.SOCKET_URL, {
        transports: ['websocket']
      });

      socket.on('connect', () => {
        console.log(`🔌 Socket connected for user ${userId}: ${socket.id}`);
        
        // Join user room
        socket.emit('join_user_room', { userId, userToken });
        
        socket.on('user_room_joined', (data) => {
          console.log(`✅ User ${userId} joined their room`);
          this.sockets[userId] = socket;
          this.setupEventListeners(socket, userId);
          resolve(socket);
        });
      });

      socket.on('connect_error', (error) => {
        console.error(`❌ Socket connection failed for user ${userId}:`, error);
        reject(error);
      });

      setTimeout(() => {
        reject(new Error('Socket connection timeout'));
      }, 5000);
    });
  }

  /**
   * Setup event listeners for testing
   */
  setupEventListeners(socket, userId) {
    const events = [
      'new_message',
      'user_typing',
      'offer_received',
      'offer_response',
      'message_notification',
      'user_joined_chat',
      'user_left_chat',
      'error'
    ];

    events.forEach(event => {
      socket.on(event, (data) => {
        const logEntry = {
          timestamp: new Date().toISOString(),
          userId,
          event,
          data
        };
        
        this.eventLog.push(logEntry);
        console.log(`📡 [${userId}] ${event}:`, data);
      });
    });
  }

  /**
   * Test joining a chat room
   */
  async testJoinChat(userId, chatId) {
    const socket = this.sockets[userId];
    if (!socket) {
      throw new Error(`Socket not found for user ${userId}`);
    }

    return new Promise((resolve, reject) => {
      socket.emit('join_chat', { chatId, userId });
      
      socket.on('chat_joined', (data) => {
        console.log(`✅ User ${userId} joined chat ${chatId}`);
        resolve(data);
      });

      socket.on('error', (error) => {
        console.error(`❌ Join chat failed for user ${userId}:`, error);
        reject(error);
      });

      setTimeout(() => {
        reject(new Error('Join chat timeout'));
      }, 3000);
    });
  }

  /**
   * Test sending message via socket
   */
  testSendMessageSocket(userId, chatId, content, messageType = 'TEXT') {
    const socket = this.sockets[userId];
    if (!socket) {
      throw new Error(`Socket not found for user ${userId}`);
    }

    const tempId = `temp_${Date.now()}`;
    
    socket.emit('send_message', {
      chatId,
      content,
      messageType,
      temp_id: tempId
    });

    console.log(`📤 [Socket] User ${userId} sent message to chat ${chatId}`);
    return tempId;
  }

  /**
   * Test typing indicators
   */
  testTypingIndicator(userId, chatId, isTyping) {
    const socket = this.sockets[userId];
    if (!socket) {
      throw new Error(`Socket not found for user ${userId}`);
    }

    socket.emit(isTyping ? 'typing_start' : 'typing_stop', { chatId });
    console.log(`⌨️  [Socket] User ${userId} ${isTyping ? 'started' : 'stopped'} typing`);
  }

  /**
   * Test sending offer via socket
   */
  testSendOfferSocket(userId, chatId, offerAmount, notes = '') {
    const socket = this.sockets[userId];
    if (!socket) {
      throw new Error(`Socket not found for user ${userId}`);
    }

    const tempId = `offer_${Date.now()}`;
    
    socket.emit('send_offer', {
      chatId,
      offerAmount,
      messageType: 'OFFER',
      notes,
      temp_id: tempId
    });

    console.log(`💰 [Socket] User ${userId} sent offer: $${offerAmount}`);
    return tempId;
  }

  /**
   * Disconnect all sockets
   */
  disconnectAll() {
    Object.entries(this.sockets).forEach(([userId, socket]) => {
      socket.disconnect();
      console.log(`🔌 Disconnected socket for user ${userId}`);
    });
    this.sockets = {};
  }

  /**
   * Get event log
   */
  getEventLog() {
    return this.eventLog;
  }

  /**
   * Clear event log
   */
  clearEventLog() {
    this.eventLog = [];
  }
}

// ================================
// COMPREHENSIVE TEST SUITE
// ================================

class ChatSystemTester {
  constructor() {
    this.apiTester = new ChatAPITester();
    this.socketTester = new ChatSocketTester();
  }

  /**
   * Run complete chat system test
   */
  async runCompleteTest() {
    try {
      console.log('🚀 Starting comprehensive chat system test...\n');

      // 1. Setup test users
      const { tokens, users } = await this.apiTester.setupTestUsers();
      
      // 2. Create test listing
      const listing = await this.apiTester.createTestListing(tokens.vendor);
      
      // 3. Test product chat creation
      const productChat = await this.apiTester.testProductChatCreation(
        tokens.buyer, 
        listing.id, 
        "Hi! I'm interested in this iPhone. Is the price negotiable?"
      );

      // 4. Test vendor chat creation
      const vendorChat = await this.apiTester.testVendorChatCreation(
        tokens.buyer,
        users.vendor.id,
        "Hello! I wanted to ask about your other products."
      );

      // 5. Connect sockets
      await this.socketTester.connectUserSocket(users.buyer.id, tokens.buyer);
      await this.socketTester.connectUserSocket(users.vendor.id, tokens.vendor);

      // 6. Test socket chat joining
      await this.socketTester.testJoinChat(users.buyer.id, productChat.id);
      await this.socketTester.testJoinChat(users.vendor.id, productChat.id);

      // 7. Test real-time messaging
      console.log('\n💬 Testing real-time messaging...');
      this.socketTester.testSendMessageSocket(
        users.vendor.id, 
        productChat.id, 
        "Hello! Yes, the price is negotiable. What did you have in mind?"
      );

      await this.delay(1000);

      this.socketTester.testSendMessageSocket(
        users.buyer.id, 
        productChat.id, 
        "I was thinking around $850. Would that work?"
      );

      // 8. Test typing indicators
      console.log('\n⌨️  Testing typing indicators...');
      this.socketTester.testTypingIndicator(users.vendor.id, productChat.id, true);
      await this.delay(2000);
      this.socketTester.testTypingIndicator(users.vendor.id, productChat.id, false);

      // 9. Test offers via socket
      console.log('\n💰 Testing offer system...');
      this.socketTester.testSendOfferSocket(
        users.buyer.id,
        productChat.id,
        850,
        "This is my best offer for the iPhone"
      );

      await this.delay(2000);

      // 10. Test API-based messaging
      console.log('\n📤 Testing API messaging...');
      await this.apiTester.testSendMessage(
        tokens.vendor,
        productChat.id,
        "Let me consider your offer. I'll get back to you shortly."
      );

      // 11. Test getting chats
      console.log('\n📋 Testing chat retrieval...');
      await this.apiTester.testGetUserChats(tokens.buyer);
      await this.apiTester.testGetUserChats(tokens.vendor);

      // 12. Wait for real-time events
      console.log('\n⏳ Waiting for real-time events...');
      await this.delay(3000);

      // 13. Show event log
      console.log('\n📊 Event log summary:');
      const events = this.socketTester.getEventLog();
      console.log(`Total events received: ${events.length}`);
      
      events.forEach(event => {
        console.log(`  - [${event.userId}] ${event.event} at ${event.timestamp}`);
      });

      console.log('\n✅ Complete chat system test finished successfully!');
      
      return {
        success: true,
        summary: {
          users_created: Object.keys(users).length,
          chats_created: 2,
          events_received: events.length,
          test_duration: '~30 seconds'
        }
      };

    } catch (error) {
      console.error('\n❌ Chat system test failed:', error);
      throw error;
    } finally {
      // Cleanup
      this.socketTester.disconnectAll();
    }
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ================================
// EXPORT UTILITIES
// ================================

module.exports = {
  ChatAPITester,
  ChatSocketTester,
  ChatSystemTester,
  TEST_CONFIG
};

// ================================
// COMMAND LINE EXECUTION
// ================================

if (require.main === module) {
  const tester = new ChatSystemTester();
  
  tester.runCompleteTest()
    .then(result => {
      console.log('\n🎉 Test Results:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Test Failed:', error.message);
      process.exit(1);
    });
}