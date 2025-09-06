// apps/backend/src/services/OpayService.js
// Opay payment service for Nigerian market with wallet and QR payments

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { 
  PAYMENT_METHODS, 
  PAYMENT_PROVIDERS,
  PROVIDER_CONFIGS 
} = require('../config/paymentConfig');

class OpayService {
  constructor() {
    this.config = PROVIDER_CONFIGS[PAYMENT_PROVIDERS.OPAY];
    this.baseUrl = process.env.NODE_ENV === 'production' 
      ? this.config.liveBaseUrl 
      : this.config.baseUrl;
    this.merchantId = process.env.OPAY_MERCHANT_ID;
    this.secretKey = process.env.OPAY_SECRET_KEY;
    this.publicKey = process.env.OPAY_PUBLIC_KEY;
    this.isInitialized = false;
  }

  // ================================
  // INITIALIZATION
  // ================================

  /**
   * Initialize Opay service
   */
  static async initialize() {
    const instance = new OpayService();
    
    if (!instance.merchantId || !instance.secretKey) {
      logger.warn('⚠️  Opay credentials not configured - Opay payments disabled');
      return instance;
    }

    try {
      // Test connection
      await instance.verifyCredentials();
      instance.isInitialized = true;
      logger.info('✅ Opay service initialized successfully');
      
      return instance;
    } catch (error) {
      logger.error('❌ Opay initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Verify Opay credentials
   */
  async verifyCredentials() {
    try {
      const response = await this.makeRequest('/api/v1/international/inquiry-balance', {
        method: 'POST',
        body: {}
      });

      if (response.code !== '00000') {
        throw new Error(`Opay credential verification failed: ${response.message}`);
      }

      return { verified: true, balance: response.data };
    } catch (error) {
      throw new Error(`Opay verification failed: ${error.message}`);
    }
  }

  // ================================
  // WALLET PAYMENTS
  // ================================

  /**
   * Initiate wallet payment
   */
  async createWalletPayment(paymentData) {
    const {
      amount,
      userPhoneNumber,
      reference,
      description,
      metadata = {}
    } = paymentData;

    try {
      const payload = {
        reference,
        mchShortName: this.merchantId,
        productName: description || 'Void Marketplace Purchase',
        productDesc: description || 'Product purchase on Void Marketplace',
        userPhone: userPhoneNumber,
        userRequestIp: metadata.userIp || '127.0.0.1',
        amount: Math.round(amount), // Amount in kobo
        currency: 'NGN',
        payMethods: ['wallet', 'card'],
        payTypes: ['WalletNigeria', 'BankCard'],
        callbackUrl: `${process.env.BACKEND_URL}/api/v1/payments/opay/callback`,
        returnUrl: `${process.env.FRONTEND_URL}/payment/success`,
        expireAt: Math.floor(Date.now() / 1000) + (15 * 60) // 15 minutes
      };

      const response = await this.makeRequest('/api/v1/international/cashier', {
        method: 'POST',
        body: payload
      });

      if (response.code !== '00000') {
        throw new Error(`Opay payment creation failed: ${response.message}`);
      }

      return {
        success: true,
        reference: response.data.reference,
        cashierUrl: response.data.cashierUrl,
        qrCode: response.data.qrCode, // QR code for mobile payments
        orderNo: response.data.orderNo,
        provider: 'opay',
        expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
      };

    } catch (error) {
      logger.error('Opay wallet payment creation failed:', error);
      throw error;
    }
  }

  // ================================
  // QR CODE PAYMENTS
  // ================================

  /**
   * Generate QR code for payment
   */
  async generateQRPayment(paymentData) {
    const {
      amount,
      reference,
      description,
      metadata = {}
    } = paymentData;

    try {
      const payload = {
        reference,
        amount: Math.round(amount),
        currency: 'NGN',
        description: description || 'Void Marketplace QR Payment',
        expiryMinutes: 15
      };

      const response = await this.makeRequest('/api/v1/international/qrcode/create', {
        method: 'POST',
        body: payload
      });

      if (response.code !== '00000') {
        throw new Error(`QR code generation failed: ${response.message}`);
      }

      return {
        success: true,
        qrCode: response.data.qrCode,
        qrData: response.data.qrData,
        reference: response.data.reference,
        expires_at: new Date(Date.now() + 15 * 60 * 1000)
      };

    } catch (error) {
      logger.error('Opay QR code generation failed:', error);
      throw error;
    }
  }

  // ================================
  // BANK TRANSFER
  // ================================

  /**
   * Create bank transfer payment
   */
  async createBankTransfer(paymentData) {
    const {
      amount,
      bankCode,
      accountNumber,
      accountName,
      reference,
      description
    } = paymentData;

    try {
      const payload = {
        reference,
        amount: Math.round(amount),
        currency: 'NGN',
        country: 'NG',
        bankCode,
        bankAccountNumber: accountNumber,
        bankAccountName: accountName,
        reason: description || 'Void Marketplace Payment'
      };

      const response = await this.makeRequest('/api/v1/international/transfer-to-bank', {
        method: 'POST',
        body: payload
      });

      if (response.code !== '00000') {
        throw new Error(`Bank transfer failed: ${response.message}`);
      }

      return {
        success: true,
        reference: response.data.reference,
        orderNo: response.data.orderNo,
        status: response.data.status
      };

    } catch (error) {
      logger.error('Opay bank transfer failed:', error);
      throw error;
    }
  }

  // ================================
  // PAYMENT VERIFICATION
  // ================================

  /**
   * Verify payment status
   */
  async verifyPayment(reference) {
    try {
      const payload = {
        reference,
        orderNo: reference // Opay uses reference as orderNo in some cases
      };

      const response = await this.makeRequest('/api/v1/international/status', {
        method: 'POST',
        body: payload
      });

      if (response.code !== '00000') {
        throw new Error(`Payment verification failed: ${response.message}`);
      }

      const payment = response.data;
      
      return {
        reference: payment.reference,
        amount: payment.amount,
        status: this.mapOpayStatus(payment.status),
        paid_at: payment.payTime ? new Date(payment.payTime) : null,
        fees: payment.fee || 0,
        gateway_response: payment.failureReason || payment.status,
        channel: payment.payMethod || 'opay',
        currency: payment.currency || 'NGN'
      };

    } catch (error) {
      logger.error('Opay payment verification failed:', error);
      throw error;
    }
  }

  // ================================
  // BULK TRANSFERS (FOR VENDOR PAYOUTS)
  // ================================

  /**
   * Transfer to vendor account
   */
  async transferToVendor(transferData) {
    const {
      amount,
      bankCode,
      accountNumber,
      accountName,
      reference,
      vendorId,
      notes
    } = transferData;

    try {
      const payload = {
        reference,
        amount: Math.round(amount),
        currency: 'NGN',
        country: 'NG',
        bankCode,
        bankAccountNumber: accountNumber,
        bankAccountName: accountName,
        reason: notes || `Vendor payout - ${vendorId}`
      };

      const response = await this.makeRequest('/api/v1/international/transfer-to-bank', {
        method: 'POST',
        body: payload
      });

      if (response.code !== '00000') {
        throw new Error(`Vendor transfer failed: ${response.message}`);
      }

      return {
        success: true,
        reference: response.data.reference,
        orderNo: response.data.orderNo,
        status: response.data.status,
        transferredAt: new Date()
      };

    } catch (error) {
      logger.error('Opay vendor transfer failed:', error);
      throw error;
    }
  }

  // ================================
  // WEBHOOK VERIFICATION
  // ================================

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload, signature) {
    try {
      const computedSignature = crypto
        .createHmac('sha512', this.secretKey)
        .update(JSON.stringify(payload))
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(computedSignature)
      );
    } catch (error) {
      logger.error('Opay webhook verification failed:', error);
      return false;
    }
  }

  // ================================
  // UTILITY METHODS
  // ================================

  /**
   * Map Opay status to standard status
   */
  mapOpayStatus(opayStatus) {
    const statusMap = {
      'SUCCESS': 'success',
      'PENDING': 'pending',
      'FAILED': 'failed',
      'CLOSE': 'failed',
      'INITIAL': 'pending'
    };

    return statusMap[opayStatus] || 'pending';
  }

  /**
   * Make authenticated request to Opay API
   */
  async makeRequest(endpoint, options = {}) {
    const { method = 'GET', body = null } = options;
    
    const timestamp = Math.floor(Date.now() / 1000);
    const requestId = this.generateRequestId();
    
    // Create signature
    const signData = `${method}${endpoint}${timestamp}${requestId}${this.merchantId}${JSON.stringify(body || {})}`;
    const signature = crypto
      .createHmac('sha512', this.secretKey)
      .update(signData)
      .digest('hex');

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.publicKey}`,
      'MerchantId': this.merchantId,
      'RequestId': requestId,
      'Timestamp': timestamp.toString(),
      'Signature': signature
    };

    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers,
        data: body,
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error('Opay API error:', {
          status: error.response.status,
          data: error.response.data,
          endpoint
        });
        throw new Error(`Opay API error: ${error.response.data.message || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Generate unique request ID
   */
  generateRequestId() {
    return `void_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get supported Nigerian banks for Opay
   */
  async getSupportedBanks() {
    try {
      const response = await this.makeRequest('/api/v1/international/bank-list', {
        method: 'POST',
        body: { countryCode: 'NG' }
      });

      if (response.code !== '00000') {
        throw new Error(`Failed to get bank list: ${response.message}`);
      }

      return response.data.map(bank => ({
        code: bank.bankCode,
        name: bank.bankName,
        slug: bank.bankCode.toLowerCase()
      }));

    } catch (error) {
      logger.error('Failed to get Opay bank list:', error);
      // Return common Nigerian banks as fallback
      return [
        { code: '044', name: 'Access Bank', slug: 'access-bank' },
        { code: '014', name: 'AfriBank', slug: 'afribank' },
        { code: '063', name: 'Diamond Bank', slug: 'diamond-bank' },
        { code: '050', name: 'Ecobank Nigeria', slug: 'ecobank-nigeria' },
        { code: '070', name: 'Fidelity Bank', slug: 'fidelity-bank' },
        { code: '011', name: 'First Bank', slug: 'first-bank' },
        { code: '214', name: 'First City Monument Bank', slug: 'fcmb' },
        { code: '058', name: 'Guaranty Trust Bank', slug: 'gtbank' },
        { code: '030', name: 'Heritage Bank', slug: 'heritage-bank' },
        { code: '082', name: 'Keystone Bank', slug: 'keystone-bank' },
        { code: '076', name: 'Polaris Bank', slug: 'polaris-bank' },
        { code: '221', name: 'Stanbic IBTC Bank', slug: 'stanbic-ibtc' },
        { code: '068', name: 'Standard Chartered Bank', slug: 'standard-chartered' },
        { code: '232', name: 'Sterling Bank', slug: 'sterling-bank' },
        { code: '032', name: 'Union Bank', slug: 'union-bank' },
        { code: '033', name: 'United Bank for Africa', slug: 'uba' },
        { code: '215', name: 'Unity Bank', slug: 'unity-bank' },
        { code: '035', name: 'Wema Bank', slug: 'wema-bank' },
        { code: '057', name: 'Zenith Bank', slug: 'zenith-bank' }
      ];
    }
  }

  /**
   * Validate Nigerian phone number for Opay wallet
   */
  validateNigerianPhone(phoneNumber) {
    // Remove country code and normalize
    const normalized = phoneNumber.replace(/^\+?234/, '0').replace(/\s+/g, '');
    
    if (!/^0[7-9][0-1]\d{8}$/.test(normalized)) {
      return {
        valid: false,
        error: 'Invalid Nigerian phone number format'
      };
    }

    return {
      valid: true,
      normalized: normalized
    };
  }
}

// ================================
// EXPORT SINGLETON INSTANCE
// ================================

let opayInstance = null;

module.exports = {
  OpayService,
  
  // Singleton factory
  getInstance: () => {
    if (!opayInstance) {
      opayInstance = new OpayService();
    }
    return opayInstance;
  },

  // Initialize and return instance
  initialize: async () => {
    return await OpayService.initialize();
  }
};