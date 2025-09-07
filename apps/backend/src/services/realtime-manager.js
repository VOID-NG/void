// apps/backend/src/services/realtime-manager.js
// real-time performance optimization for Socket.IO

const { Server } = require('socket.io');
const Redis = require('ioredis');
const { createAdapter } = require('@socket.io/redis-adapter');
const logger = require('../utils/logger');
const { getCacheManager } = require('./cache-manager');
const { EventEmitter } = require('events');

// ================================
// HIGH-PERFORMANCE SOCKET.IO MANAGER
// ================================

class RealTimeManager extends EventEmitter {
  constructor() {
    super();
    
    this.io = null;
    this.redisAdapter = null;
    this.connectionPool = new Map();
    this.roomManager = new Map();
    this.messageQueue = [];
    this.batchProcessor = null;
    
    // Performance metrics
    this.metrics = {
      connections: 0,
      peakConnections: 0,
      messagesPerSecond: 0,
      totalMessages: 0,
      latency: {
        min: Infinity,
        max: 0,
        avg: 0,
        samples: []
      },
      rooms: {
        active: 0,
        total: 0
      }
    };
    
    this.cache = getCacheManager();
    this.setupPerformanceMonitoring();
  }

  // ================================
  // OPTIMIZED SOCKET.IO INITIALIZATION
  // ================================

  async initialize(httpServer) {
    try {
      logger.info('🚀 Initializing high-performance Socket.IO...');
      
      // Create optimized Socket.IO instance
      this.io = new Server(httpServer, {
        // Connection optimization
        pingTimeout: 60000,
        pingInterval: 25000,
        upgradeTimeout: 30000,
        
        // Transport optimization
        transports: ['websocket', 'polling'],
        allowUpgrades: true,
        
        // Performance tuning
        maxHttpBufferSize: 1e6, // 1MB
        httpCompression: true,
        compression: true,
        
        // CORS optimization
        cors: {
          origin: process.env.FRONTEND_URLS?.split(',') || [
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:8081"
          ],
          credentials: true,
          methods: ["GET", "POST"]
        },
        
        // Connection state recovery for reliability
        connectionStateRecovery: {
          maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
          skipMiddlewares: true,
        },
        
        // Cluster optimization
        adapter: await this.createRedisAdapter()
      });

      // Set up optimized event handlers
      this.setupOptimizedHandlers();
      
      // Initialize batch processing
      this.setupBatchProcessing();
      
      // Initialize room management
      this.setupRoomManagement();
      
      // Initialize rate limiting
      this.setupRateLimiting();
      
      logger.info('✅ High-performance Socket.IO initialized');
      
      return this.io;
      
    } catch (error) {
      logger.error('❌ Socket.IO initialization failed:', error);
      throw error;
    }
  }

  async createRedisAdapter() {
    try {
      if (!process.env.REDIS_URL) {
        logger.warn('⚠️  Redis not configured, using in-memory adapter');
        return null;
      }

      const pubClient = new Redis(process.env.REDIS_URL, {
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false
      });
      
      const subClient = pubClient.duplicate();
      
      const adapter = createAdapter(pubClient, subClient, {
        // Adapter optimization
        key: 'socket.io',
        requestsTimeout: 5000,
        publishOnSpecificResponseChannel: true,
        parser: {
          encode: JSON.stringify,
          decode: JSON.parse
        }
      });
      
      logger.info('✅ Redis adapter configured for Socket.IO clustering');
      return adapter;
      
    } catch (error) {
      logger.error('Redis adapter setup failed:', error);
      return null;
    }
  }

  // ================================
  // OPTIMIZED EVENT HANDLERS
  // ================================

  setupOptimizedHandlers() {
    // Connection handling with performance optimization
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    // Middleware for authentication and rate limiting
    this.io.use(async (socket, next) => {
      await this.authenticateSocket(socket, next);
    });
  }

  async handleConnection(socket) {
    const startTime = Date.now();
    
    try {
      // Update metrics
      this.metrics.connections++;
      this.metrics.peakConnections = Math.max(this.metrics.peakConnections, this.metrics.connections);
      
      // Store connection info
      this.connectionPool.set(socket.id, {
        userId: socket.user?.id,
        connectedAt: startTime,
        lastActivity: startTime,
        rooms: new Set(),
        rateLimitTokens: 100, // Token bucket for rate limiting
        lastTokenRefill: startTime
      });

      // Join user to appropriate rooms
      await this.joinUserRooms(socket);
      
      // Set up optimized event handlers
      this.setupSocketEventHandlers(socket);
      
      // Track connection performance
      const connectionTime = Date.now() - startTime;
      this.updateLatencyMetrics(connectionTime);
      
      logger.info('📱 Client connected', {
        socketId: socket.id,
        userId: socket.user?.id || 'anonymous',
        connectionTime: `${connectionTime}ms`,
        totalConnections: this.metrics.connections
      });
      
      // Emit connection success with cached data
      await this.sendWelcomeData(socket);
      
    } catch (error) {
      logger.error('Connection handling failed:', error);
      socket.emit('error', { message: 'Connection setup failed' });
    }
  }

  setupSocketEventHandlers(socket) {
    // Optimized message handling
    socket.on('send_message', async (data) => {
      await this.handleMessage(socket, data);
    });

    // Typing indicators with throttling
    socket.on('typing_start', this.throttle(async (data) => {
      await this.handleTypingStart(socket, data);
    }, 1000)); // Max once per second

    socket.on('typing_stop', async (data) => {
      await this.handleTypingStop(socket, data);
    });

    // Room management
    socket.on('join_room', async (data) => {
      await this.handleJoinRoom(socket, data);
    });

    socket.on('leave_room', async (data) => {
      await this.handleLeaveRoom(socket, data);
    });

    // Connection quality monitoring
    socket.on('ping', (callback) => {
      if (typeof callback === 'function') {
        callback();
      }
    });

    // Disconnect handling
    socket.on('disconnect', (reason) => {
      this.handleDisconnect(socket, reason);
    });
  }

  // ================================
  // MESSAGE PROCESSING OPTIMIZATION
  // ================================

  async handleMessage(socket, data) {
    const startTime = Date.now();
    
    try {
      // Rate limiting check
      if (!this.checkRateLimit(socket)) {
        socket.emit('error', { 
          code: 'RATE_LIMITED',
          message: 'Too many messages, please slow down' 
        });
        return;
      }

      // Validate message data
      if (!this.validateMessageData(data)) {
        socket.emit('error', { 
          code: 'INVALID_DATA',
          message: 'Invalid message format' 
        });
        return;
      }

      // Add to batch processor for efficiency
      this.addToBatch({
        type: 'message',
        socket: socket,
        data: data,
        timestamp: startTime
      });

      // Update activity tracking
      this.updateSocketActivity(socket);
      
    } catch (error) {
      logger.error('Message handling failed:', error);
      socket.emit('error', { message: 'Failed to process message' });
    }
  }

  // ================================
  // BATCH PROCESSING FOR EFFICIENCY
  // ================================

  setupBatchProcessing() {
    this.batchProcessor = setInterval(async () => {
      await this.processBatch();
    }, 50); // Process every 50ms for optimal throughput
  }

  addToBatch(item) {
    this.messageQueue.push(item);
    
    // Process immediately if queue is getting large
    if (this.messageQueue.length > 100) {
      setImmediate(() => this.processBatch());
    }
  }

  async processBatch() {
    if (this.messageQueue.length === 0) return;
    
    const batch = this.messageQueue.splice(0, 100); // Process up to 100 items
    const processingStart = Date.now();
    
    try {
      // Group by operation type for efficient processing
      const groupedOperations = this.groupBatchOperations(batch);
      
      // Process messages in bulk
      await this.processBatchedMessages(groupedOperations.messages || []);
      
      // Process room operations
      await this.processBatchedRoomOperations(groupedOperations.roomOps || []);
      
      // Update metrics
      this.metrics.messagesPerSecond = batch.length / ((Date.now() - processingStart) / 1000);
      this.metrics.totalMessages += batch.length;
      
      logger.debug('📦 Batch processed', {
        itemCount: batch.length,
        processingTime: `${Date.now() - processingStart}ms`,
        messagesPerSecond: this.metrics.messagesPerSecond
      });
      
    } catch (error) {
      logger.error('Batch processing failed:', error);
    }
  }

  groupBatchOperations(batch) {
    const groups = {
      messages: [],
      roomOps: [],
      typing: []
    };
    
    batch.forEach(item => {
      switch (item.type) {
        case 'message':
          groups.messages.push(item);
          break;
        case 'join_room':
        case 'leave_room':
          groups.roomOps.push(item);
          break;
        case 'typing':
          groups.typing.push(item);
          break;
      }
    });
    
    return groups;
  }

  async processBatchedMessages(messageItems) {
    if (messageItems.length === 0) return;
    
    try {
      // Prepare database operations
      const messageService = require('./messageService');
      const dbOperations = [];
      const socketNotifications = [];
      
      for (const item of messageItems) {
        const { socket, data } = item;
        
        // Prepare database save
        dbOperations.push({
          chat_id: data.chatId,
          sender_id: socket.user?.id,
          content: data.content,
          type: data.type || 'TEXT'
        });
        
        // Prepare socket notifications
        socketNotifications.push({
          chatId: data.chatId,
          senderId: socket.user?.id,
          messageData: data
        });
      }
      
      // Bulk save to database
      if (dbOperations.length > 0) {
        await messageService.createMessagesBulk(dbOperations);
      }
      
      // Bulk emit to socket rooms
      for (const notification of socketNotifications) {
        this.io.to(`chat_${notification.chatId}`).emit('new_message', {
          ...notification.messageData,
          sender_id: notification.senderId,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      logger.error('Batched message processing failed:', error);
    }
  }

  // ================================
  // INTELLIGENT ROOM MANAGEMENT
  // ================================

  setupRoomManagement() {
    // Track room statistics
    setInterval(() => {
      this.updateRoomStatistics();
    }, 30000); // Every 30 seconds
    
    // Clean up empty rooms
    setInterval(() => {
      this.cleanupEmptyRooms();
    }, 300000); // Every 5 minutes
  }

  async joinUserRooms(socket) {
    try {
      if (!socket.user) return;
      
      const userId = socket.user.id;
      const userRole = socket.user.role;
      
      // Join personal room
      await socket.join(`user_${userId}`);
      this.trackRoomJoin(socket, `user_${userId}`);
      
      // Join role-based rooms
      const roleRooms = this.getRoleBasedRooms(userRole);
      for (const room of roleRooms) {
        await socket.join(room);
        this.trackRoomJoin(socket, room);
      }
      
      // Join active chat rooms
      const activeChatRooms = await this.getActiveChatRooms(userId);
      for (const chatRoom of activeChatRooms) {
        await socket.join(`chat_${chatRoom}`);
        this.trackRoomJoin(socket, `chat_${chatRoom}`);
      }
      
    } catch (error) {
      logger.error('Failed to join user rooms:', error);
    }
  }

  trackRoomJoin(socket, roomName) {
    const connection = this.connectionPool.get(socket.id);
    if (connection) {
      connection.rooms.add(roomName);
    }
    
    if (!this.roomManager.has(roomName)) {
      this.roomManager.set(roomName, {
        members: new Set(),
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
    }
    
    const room = this.roomManager.get(roomName);
    room.members.add(socket.id);
    room.lastActivity = Date.now();
  }

  // ================================
  // RATE LIMITING AND THROTTLING
  // ================================

  setupRateLimiting() {
    // Token bucket algorithm for rate limiting
    setInterval(() => {
      this.refillTokenBuckets();
    }, 1000); // Refill every second
  }

  checkRateLimit(socket) {
    const connection = this.connectionPool.get(socket.id);
    if (!connection) return false;
    
    // Token bucket algorithm
    if (connection.rateLimitTokens > 0) {
      connection.rateLimitTokens--;
      return true;
    }
    
    return false;
  }

  refillTokenBuckets() {
    for (const [socketId, connection] of this.connectionPool) {
      const now = Date.now();
      const timePassed = now - connection.lastTokenRefill;
      const tokensToAdd = Math.floor(timePassed / 1000) * 10; // 10 tokens per second
      
      connection.rateLimitTokens = Math.min(100, connection.rateLimitTokens + tokensToAdd);
      connection.lastTokenRefill = now;
    }
  }

  throttle(func, delay) {
    const throttled = new Map();
    
    return function(...args) {
      const socket = this;
      const key = socket.id;
      
      if (!throttled.has(key)) {
        throttled.set(key, true);
        
        setTimeout(() => {
          throttled.delete(key);
        }, delay);
        
        return func.apply(socket, args);
      }
    };
  }

  // ================================
  // PERFORMANCE MONITORING
  // ================================

  setupPerformanceMonitoring() {
    // Real-time metrics collection
    setInterval(() => {
      this.collectMetrics();
    }, 10000); // Every 10 seconds
    
    // Performance reporting
    setInterval(() => {
      this.reportPerformanceMetrics();
    }, 60000); // Every minute
  }

  collectMetrics() {
    // Update room statistics
    this.metrics.rooms.active = Array.from(this.roomManager.values())
      .filter(room => room.members.size > 0).length;
    this.metrics.rooms.total = this.roomManager.size;
    
    // Calculate average latency
    if (this.metrics.latency.samples.length > 0) {
      const sum = this.metrics.latency.samples.reduce((a, b) => a + b, 0);
      this.metrics.latency.avg = sum / this.metrics.latency.samples.length;
      
      // Keep only recent samples
      if (this.metrics.latency.samples.length > 100) {
        this.metrics.latency.samples = this.metrics.latency.samples.slice(-50);
      }
    }
  }

  updateLatencyMetrics(latency) {
    this.metrics.latency.min = Math.min(this.metrics.latency.min, latency);
    this.metrics.latency.max = Math.max(this.metrics.latency.max, latency);
    this.metrics.latency.samples.push(latency);
  }

  reportPerformanceMetrics() {
    const metrics = {
      connections: this.metrics.connections,
      peakConnections: this.metrics.peakConnections,
      messagesPerSecond: Math.round(this.metrics.messagesPerSecond),
      totalMessages: this.metrics.totalMessages,
      avgLatency: Math.round(this.metrics.latency.avg),
      rooms: this.metrics.rooms,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 // MB
    };
    
    logger.info('📊 Real-time Performance Metrics', metrics);
    
    // Alert on performance issues
    if (metrics.connections > 5000) {
      logger.warn('⚠️  High connection count', { connections: metrics.connections });
    }
    
    if (metrics.avgLatency > 1000) {
      logger.warn('⚠️  High average latency', { latency: metrics.avgLatency });
    }
    
    if (metrics.messagesPerSecond < 10 && this.metrics.totalMessages > 100) {
      logger.warn('⚠️  Low message throughput', { mps: metrics.messagesPerSecond });
    }
  }

  // ================================
  // UTILITY METHODS
  // ================================

  handleDisconnect(socket, reason) {
    try {
      this.metrics.connections--;
      
      const connection = this.connectionPool.get(socket.id);
      if (connection) {
        // Remove from rooms
        for (const room of connection.rooms) {
          const roomData = this.roomManager.get(room);
          if (roomData) {
            roomData.members.delete(socket.id);
          }
        }
      }
      
      this.connectionPool.delete(socket.id);
      
      logger.info('📱 Client disconnected', {
        socketId: socket.id,
        userId: connection?.userId || 'anonymous',
        reason: reason,
        connectionCount: this.metrics.connections
      });
      
    } catch (error) {
      logger.error('Disconnect handling failed:', error);
    }
  }

  async sendWelcomeData(socket) {
    try {
      if (!socket.user) return;
      
      // Send cached user data
      const cachedUserData = await this.cache.get(`user:profile:${socket.user.id}`);
      if (cachedUserData) {
        socket.emit('user_data', cachedUserData);
      }
      
      // Send unread message count
      const unreadCount = await this.cache.get(`unread_count:${socket.user.id}`);
      if (unreadCount !== null) {
        socket.emit('unread_count', { count: unreadCount });
      }
      
    } catch (error) {
      logger.warn('Failed to send welcome data:', error);
    }
  }

  validateMessageData(data) {
    return data && 
           typeof data.chatId === 'string' && 
           typeof data.content === 'string' && 
           data.content.trim().length > 0 &&
           data.content.length <= 5000; // Max message length
  }

  updateSocketActivity(socket) {
    const connection = this.connectionPool.get(socket.id);
    if (connection) {
      connection.lastActivity = Date.now();
    }
  }

  getRoleBasedRooms(role) {
    const roleRooms = {
      'SUPER_ADMIN': ['admins', 'vendors', 'moderators'],
      'ADMIN': ['admins', 'vendors'],
      'MODERATOR': ['moderators'],
      'VENDOR': ['vendors'],
      'USER': ['users']
    };
    
    return roleRooms[role] || ['users'];
  }

  async getActiveChatRooms(userId) {
    try {
      const cached = await this.cache.get(`user_chats:${userId}`);
      if (cached) return cached;
      
      // Fallback to database if not cached
      const { dbRouter } = require('../config/db');
      const client = dbRouter.getReadClient();
      
      const chats = await client.chat.findMany({
        where: {
          OR: [
            { buyer_id: userId },
            { vendor_id: userId }
          ],
          status: 'ACTIVE'
        },
        select: { id: true }
      });
      
      const chatIds = chats.map(chat => chat.id);
      
      // Cache for future use
      await this.cache.set(`user_chats:${userId}`, chatIds, 300);
      
      return chatIds;
      
    } catch (error) {
      logger.error('Failed to get active chat rooms:', error);
      return [];
    }
  }

  async cleanup() {
    try {
      if (this.batchProcessor) {
        clearInterval(this.batchProcessor);
      }
      
      if (this.io) {
        this.io.close();
      }
      
      this.connectionPool.clear();
      this.roomManager.clear();
      
      logger.info('✅ Real-time manager cleanup completed');
      
    } catch (error) {
      logger.error('Real-time manager cleanup failed:', error);
    }
  }
}

// ================================
// SINGLETON INSTANCE
// ================================

let realtimeManager = null;

const getRealTimeManager = () => {
  if (!realtimeManager) {
    realtimeManager = new RealTimeManager();
  }
  return realtimeManager;
};

const initializeRealTime = async (httpServer) => {
  try {
    const manager = getRealTimeManager();
    const io = await manager.initialize(httpServer);
    
    logger.info('✅ Real-time system optimized and ready');
    return { manager, io };
    
  } catch (error) {
    logger.error('❌ Real-time initialization failed:', error);
    throw error;
  }
};

module.exports = {
  RealTimeManager,
  getRealTimeManager,
  initializeRealTime
};