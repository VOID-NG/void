// src/services/PaystackService.js
// Complete Paystack integration for Nigerian marketplace
// Supports all Nigerian payment methods: cards, bank transfers, USSD, mobile money

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { PAYMENT_PROVIDERS, PAYMENT_METHODS, formatNairaAmount, toKobo, fromKobo } = require('../config/paymentConfig');

class PaystackService {
  constructor() {
    this.baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://api.paystack.co' 
      : 'https://api.paystack.co';
    this.secretKey = process.env.PAYSTACK_SECRET_KEY;
    this.publicKey = process.env.PAYSTACK_PUBLIC_KEY;
    this.webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
    
    if (!this.secretKey) {
      throw new Error('PAYSTACK_SECRET_KEY is required');
    }

    // Create axios instance with default headers
    this.api = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Add request/response interceptors for logging
    this.api.interceptors.request.use(
      (config) => {
        logger.info('Paystack API Request:', {
          method: config.method,
          url: config.url,
          data: this.sanitizeLogData(config.data)
        });
        return config;
      },
      (error) => {
        logger.error('Paystack API Request Error:', error);
        return Promise.reject(error);
      }
    );

    this.api.interceptors.response.use(
      (response) => {
        logger.info('Paystack API Response:', {
          status: response.status,
          url: response.config.url,
          data: this.sanitizeLogData(response.data)
        });
        return response;
      },
      (error) => {
        logger.error('Paystack API Response Error:', {
          status: error.response?.status,
          url: error.config?.url,
          data: error.response?.data
        });
        return Promise.reject(error);
      }
    );
  }

  // ================================
  // INITIALIZATION
  // ================================

  static async initialize() {
    try {
      const service = new PaystackService();
      
      // Test connection
      await service.verifyConnection();
      
      logger.info('✅ Paystack service initialized successfully');
      return service;
    } catch (error) {
      logger.error('❌ Failed to initialize Paystack service:', error);
      throw error;
    }
  }

  async verifyConnection() {
    try {
      const response = await this.api.get('/bank');
      return response.status === 200;
    } catch (error) {
      throw new Error(`Paystack connection failed: ${error.message}`);
    }
  }

  // ================================
  // PAYMENT INITIALIZATION
  // ================================

  /**
   * Initialize payment transaction
   * @param {Object} paymentData - Payment details
   * @returns {Object} Payment initialization result
   */
  async initializePayment(paymentData) {
    try {
      const {
        email,
        amount, // Amount in kobo
        reference,
        callback_url,
        metadata = {},
        channels = ['card', 'bank', 'ussd', 'qr', 'mobile_money'],
        currency = 'NGN',
        split_code = null,
        subaccount = null,
        bearer = 'account'
      } = paymentData;

      // Validate required fields
      if (!email || !amount || !reference) {
        throw new Error('Email, amount, and reference are required');
      }

      // Ensure amount is in kobo
      const amountInKobo = typeof amount === 'number' ? amount : toKobo(amount);

      const payload = {
        email,
        amount: amountInKobo,
        reference,
        callback_url,
        metadata: {
          ...metadata,
          payment_provider: 'paystack',
          initiated_at: new Date().toISOString()
        },
        channels,
        currency,
        bearer
      };

      // Add split configuration if provided
      if (split_code) {
        payload.split_code = split_code;
      }

      // Add subaccount if provided
      if (subaccount) {
        payload.subaccount = subaccount;
      }

      const response = await this.api.post('/transaction/initialize', payload);

      if (!response.data.status) {
        throw new Error(response.data.message || 'Payment initialization failed');
      }

      const result = {
        success: true,
        reference: reference,
        access_code: response.data.data.access_code,
        authorization_url: response.data.data.authorization_url,
        amount: amountInKobo,
        currency: currency,
        provider: 'paystack',
        public_key: this.publicKey,
        metadata: payload.metadata
      };

      logger.info('Payment initialized successfully:', {
        reference,
        amount: formatNairaAmount(amountInKobo),
        email
      });

      return result;

    } catch (error) {
      logger.error('Payment initialization failed:', error);
      throw new Error(`Payment initialization failed: ${error.message}`);
    }
  }

  // ================================
  // PAYMENT VERIFICATION
  // ================================

  /**
   * Verify payment transaction
   * @param {string} reference - Transaction reference
   * @returns {Object} Verification result
   */
  async verifyPayment(reference) {
    try {
      if (!reference) {
        throw new Error('Transaction reference is required');
      }

      const response = await this.api.get(`/transaction/verify/${reference}`);

      if (!response.data.status) {
        throw new Error(response.data.message || 'Payment verification failed');
      }

      const transaction = response.data.data;
      
      const result = {
        success: true,
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        gateway_response: transaction.gateway_response,
        paid_at: transaction.paid_at,
        channel: transaction.channel,
        authorization: transaction.authorization,
        customer: transaction.customer,
        metadata: transaction.metadata,
        fees: transaction.fees,
        provider: 'paystack'
      };

      logger.info('Payment verified:', {
        reference,
        status: transaction.status,
        amount: formatNairaAmount(transaction.amount)
      });

      return result;

    } catch (error) {
      logger.error('Payment verification failed:', error);
      throw new Error(`Payment verification failed: ${error.message}`);
    }
  }

  // ================================
  // BANK TRANSFERS
  // ================================

  /**
   * Get banks list for Nigeria
   * @returns {Array} List of Nigerian banks
   */
  async getBanks() {
    try {
      const response = await this.api.get('/bank?country=nigeria');
      
      if (!response.data.status) {
        throw new Error('Failed to fetch banks list');
      }

      return response.data.data.map(bank => ({
        id: bank.id,
        name: bank.name,
        code: bank.code,
        slug: bank.slug,
        currency: bank.currency,
        type: bank.type,
        country: bank.country
      }));

    } catch (error) {
      logger.error('Failed to fetch banks:', error);
      throw error;
    }
  }

  /**
   * Resolve bank account details
   * @param {string} accountNumber - Account number
   * @param {string} bankCode - Bank code
   * @returns {Object} Account details
   */
  async resolveAccountNumber(accountNumber, bankCode) {
    try {
      if (!accountNumber || !bankCode) {
        throw new Error('Account number and bank code are required');
      }

      const response = await this.api.get(
        `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`
      );

      if (!response.data.status) {
        throw new Error(response.data.message || 'Account resolution failed');
      }

      const account = response.data.data;

      return {
        account_number: account.account_number,
        account_name: account.account_name,
        bank_id: account.bank_id,
        bank_code: bankCode
      };

    } catch (error) {
      logger.error('Account resolution failed:', error);
      throw new Error(`Account resolution failed: ${error.message}`);
    }
  }

  // ================================
  // TRANSFERS & PAYOUTS
  // ================================

  /**
   * Create transfer recipient
   * @param {Object} recipientData - Recipient details
   * @returns {Object} Recipient details
   */
  async createTransferRecipient(recipientData) {
    try {
      const {
        type = 'nuban',
        name,
        account_number,
        bank_code,
        currency = 'NGN',
        metadata = {}
      } = recipientData;

      if (!name || !account_number || !bank_code) {
        throw new Error('Name, account number, and bank code are required');
      }

      const payload = {
        type,
        name,
        account_number,
        bank_code,
        currency,
        metadata
      };

      const response = await this.api.post('/transferrecipient', payload);

      if (!response.data.status) {
        throw new Error(response.data.message || 'Failed to create transfer recipient');
      }

      const recipient = response.data.data;

      return {
        recipient_code: recipient.recipient_code,
        type: recipient.type,
        name: recipient.name,
        account_number: recipient.details.account_number,
        account_name: recipient.details.account_name,
        bank_code: recipient.details.bank_code,
        bank_name: recipient.details.bank_name,
        currency: recipient.currency
      };

    } catch (error) {
      logger.error('Failed to create transfer recipient:', error);
      throw error;
    }
  }

  /**
   * Initiate transfer
   * @param {Object} transferData - Transfer details
   * @returns {Object} Transfer result
   */
  async initiateTransfer(transferData) {
    try {
      const {
        source = 'balance',
        amount, // Amount in kobo
        recipient,
        reason = 'Marketplace payout',
        currency = 'NGN',
        reference = null,
        metadata = {}
      } = transferData;

      if (!amount || !recipient) {
        throw new Error('Amount and recipient are required');
      }

      // Ensure amount is in kobo
      const amountInKobo = typeof amount === 'number' ? amount : toKobo(amount);

      const payload = {
        source,
        amount: amountInKobo,
        recipient,
        reason,
        currency,
        metadata: {
          ...metadata,
          transfer_provider: 'paystack',
          initiated_at: new Date().toISOString()
        }
      };

      if (reference) {
        payload.reference = reference;
      }

      const response = await this.api.post('/transfer', payload);

      if (!response.data.status) {
        throw new Error(response.data.message || 'Transfer initiation failed');
      }

      const transfer = response.data.data;

      logger.info('Transfer initiated:', {
        reference: transfer.reference,
        amount: formatNairaAmount(amountInKobo),
        recipient
      });

      return {
        success: true,
        transfer_code: transfer.transfer_code,
        reference: transfer.reference,
        amount: transfer.amount,
        currency: transfer.currency,
        status: transfer.status,
        recipient: transfer.recipient,
        provider: 'paystack'
      };

    } catch (error) {
      logger.error('Transfer initiation failed:', error);
      throw error;
    }
  }

  // ================================
  // VIRTUAL ACCOUNTS
  // ================================

  /**
   * Create dedicated virtual account
   * @param {Object} accountData - Account details
   * @returns {Object} Virtual account details
   */
  async createVirtualAccount(accountData) {
    try {
      const {
        customer,
        preferred_bank = 'wema-bank',
        subaccount = null,
        split_code = null
      } = accountData;

      if (!customer) {
        throw new Error('Customer code is required');
      }

      const payload = {
        customer,
        preferred_bank
      };

      if (subaccount) {
        payload.subaccount = subaccount;
      }

      if (split_code) {
        payload.split_code = split_code;
      }

      const response = await this.api.post('/dedicated_account', payload);

      if (!response.data.status) {
        throw new Error(response.data.message || 'Virtual account creation failed');
      }

      const account = response.data.data;

      return {
        account_number: account.account_number,
        account_name: account.account_name,
        bank: {
          name: account.bank.name,
          id: account.bank.id,
          slug: account.bank.slug
        },
        customer: account.customer,
        active: account.active,
        currency: account.currency
      };

    } catch (error) {
      logger.error('Virtual account creation failed:', error);
      throw error;
    }
  }

  // ================================
  // SUBSCRIPTIONS
  // ================================

  /**
   * Create subscription plan
   * @param {Object} planData - Plan details
   * @returns {Object} Plan details
   */
  async createPlan(planData) {
    try {
      const {
        name,
        amount, // Amount in kobo
        interval,
        description = '',
        currency = 'NGN',
        invoice_limit = 0,
        send_invoices = true,
        send_sms = true
      } = planData;

      if (!name || !amount || !interval) {
        throw new Error('Name, amount, and interval are required');
      }

      // Ensure amount is in kobo
      const amountInKobo = typeof amount === 'number' ? amount : toKobo(amount);

      const payload = {
        name,
        amount: amountInKobo,
        interval,
        description,
        currency,
        invoice_limit,
        send_invoices,
        send_sms
      };

      const response = await this.api.post('/plan', payload);

      if (!response.data.status) {
        throw new Error(response.data.message || 'Plan creation failed');
      }

      const plan = response.data.data;

      return {
        plan_code: plan.plan_code,
        name: plan.name,
        amount: plan.amount,
        interval: plan.interval,
        currency: plan.currency,
        description: plan.description
      };

    } catch (error) {
      logger.error('Plan creation failed:', error);
      throw error;
    }
  }

  // ================================
  // WEBHOOK VERIFICATION
  // ================================

  /**
   * Verify webhook signature
   * @param {string} payload - Webhook payload
   * @param {string} signature - Webhook signature
   * @returns {boolean} Verification result
   */
  verifyWebhookSignature(payload, signature) {
    try {
      if (!this.webhookSecret) {
        logger.warn('Paystack webhook secret not configured');
        return false;
      }

      const hash = crypto
        .createHmac('sha512', this.webhookSecret)
        .update(payload)
        .digest('hex');

      return hash === signature;

    } catch (error) {
      logger.error('Webhook signature verification failed:', error);
      return false;
    }
  }

  // ================================
  // CUSTOMERS
  // ================================

  /**
   * Create customer
   * @param {Object} customerData - Customer details
   * @returns {Object} Customer details
   */
  async createCustomer(customerData) {
    try {
      const {
        email,
        first_name,
        last_name,
        phone,
        metadata = {}
      } = customerData;

      if (!email) {
        throw new Error('Email is required');
      }

      const payload = {
        email,
        first_name,
        last_name,
        phone,
        metadata
      };

      const response = await this.api.post('/customer', payload);

      if (!response.data.status) {
        throw new Error(response.data.message || 'Customer creation failed');
      }

      const customer = response.data.data;

      return {
        customer_code: customer.customer_code,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        metadata: customer.metadata
      };

    } catch (error) {
      logger.error('Customer creation failed:', error);
      throw error;
    }
  }

  // ================================
  // DISPUTES
  // ================================

  /**
   * Get dispute details
   * @param {string} disputeId - Dispute ID
   * @returns {Object} Dispute details
   */
  async getDispute(disputeId) {
    try {
      const response = await this.api.get(`/dispute/${disputeId}`);

      if (!response.data.status) {
        throw new Error(response.data.message || 'Failed to fetch dispute');
      }

      return response.data.data;

    } catch (error) {
      logger.error('Failed to fetch dispute:', error);
      throw error;
    }
  }

  /**
   * List disputes
   * @param {Object} options - Query options
   * @returns {Object} Disputes list
   */
  async listDisputes(options = {}) {
    try {
      const {
        page = 1,
        perPage = 50,
        from,
        to,
        transaction,
        status
      } = options;

      const params = new URLSearchParams({
        page: page.toString(),
        perPage: perPage.toString()
      });

      if (from) params.append('from', from);
      if (to) params.append('to', to);
      if (transaction) params.append('transaction', transaction);
      if (status) params.append('status', status);

      const response = await this.api.get(`/dispute?${params.toString()}`);

      if (!response.data.status) {
        throw new Error('Failed to fetch disputes');
      }

      return {
        disputes: response.data.data,
        meta: response.data.meta
      };

    } catch (error) {
      logger.error('Failed to fetch disputes:', error);
      throw error;
    }
  }

  // ================================
  // TRANSACTIONS
  // ================================

  /**
   * List transactions
   * @param {Object} options - Query options
   * @returns {Object} Transactions list
   */
  async listTransactions(options = {}) {
    try {
      const {
        page = 1,
        perPage = 50,
        from,
        to,
        status,
        customer,
        amount
      } = options;

      const params = new URLSearchParams({
        page: page.toString(),
        perPage: perPage.toString()
      });

      if (from) params.append('from', from);
      if (to) params.append('to', to);
      if (status) params.append('status', status);
      if (customer) params.append('customer', customer);
      if (amount) params.append('amount', amount);

      const response = await this.api.get(`/transaction?${params.toString()}`);

      if (!response.data.status) {
        throw new Error('Failed to fetch transactions');
      }

      return {
        transactions: response.data.data,
        meta: response.data.meta
      };

    } catch (error) {
      logger.error('Failed to fetch transactions:', error);
      throw error;
    }
  }

  /**
   * Get transaction timeline
   * @param {string} transactionId - Transaction ID or reference
   * @returns {Object} Transaction timeline
   */
  async getTransactionTimeline(transactionId) {
    try {
      const response = await this.api.get(`/transaction/timeline/${transactionId}`);

      if (!response.data.status) {
        throw new Error('Failed to fetch transaction timeline');
      }

      return response.data.data;

    } catch (error) {
      logger.error('Failed to fetch transaction timeline:', error);
      throw error;
    }
  }

  // ================================
  // CHARGES (For Direct Charges)
  // ================================

  /**
   * Charge authorization (for saved cards)
   * @param {Object} chargeData - Charge details
   * @returns {Object} Charge result
   */
  async chargeAuthorization(chargeData) {
    try {
      const {
        authorization_code,
        email,
        amount, // Amount in kobo
        currency = 'NGN',
        reference,
        metadata = {}
      } = chargeData;

      if (!authorization_code || !email || !amount) {
        throw new Error('Authorization code, email, and amount are required');
      }

      // Ensure amount is in kobo
      const amountInKobo = typeof amount === 'number' ? amount : toKobo(amount);

      const payload = {
        authorization_code,
        email,
        amount: amountInKobo,
        currency,
        reference,
        metadata
      };

      const response = await this.api.post('/transaction/charge_authorization', payload);

      if (!response.data.status) {
        throw new Error(response.data.message || 'Charge failed');
      }

      const transaction = response.data.data;

      return {
        success: true,
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        gateway_response: transaction.gateway_response,
        authorization: transaction.authorization
      };

    } catch (error) {
      logger.error('Authorization charge failed:', error);
      throw error;
    }
  }

  // ================================
  // REFUNDS
  // ================================

  /**
   * Create refund
   * @param {Object} refundData - Refund details
   * @returns {Object} Refund result
   */
  async createRefund(refundData) {
    try {
      const {
        transaction,
        amount = null, // Amount in kobo, null for full refund
        currency = 'NGN',
        customer_note = '',
        merchant_note = ''
      } = refundData;

      if (!transaction) {
        throw new Error('Transaction reference is required');
      }

      const payload = {
        transaction,
        currency,
        customer_note,
        merchant_note
      };

      // Add amount only if partial refund
      if (amount !== null) {
        payload.amount = typeof amount === 'number' ? amount : toKobo(amount);
      }

      const response = await this.api.post('/refund', payload);

      if (!response.data.status) {
        throw new Error(response.data.message || 'Refund failed');
      }

      const refund = response.data.data;

      return {
        success: true,
        refund_id: refund.id,
        transaction: refund.transaction,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        refunded_at: refund.refunded_at
      };

    } catch (error) {
      logger.error('Refund creation failed:', error);
      throw error;
    }
  }

  // ================================
  // UTILITIES
  // ================================

  /**
   * Sanitize data for logging (remove sensitive information)
   * @param {Object} data - Data to sanitize
   * @returns {Object} Sanitized data
   */
  sanitizeLogData(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sensitiveFields = [
      'authorization_code',
      'card',
      'account_number',
      'cvv',
      'pin',
      'otp'
    ];

    const sanitized = { ...data };

    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  /**
   * Format error response
   * @param {Error} error - Error object
   * @returns {Object} Formatted error
   */
  formatError(error) {
    return {
      success: false,
      error: error.message,
      provider: 'paystack',
      timestamp: new Date().toISOString()
    };
  }

  // ================================
  // NIGERIAN SPECIFIC FEATURES
  // ================================

  /**
   * Get available USSD banks
   * @returns {Array} USSD enabled banks
   */
  async getUSSDEnabledBanks() {
    try {
      const banks = await this.getBanks();
      
      // Filter banks that support USSD payments
      const ussdBanks = banks.filter(bank => 
        ['access', 'gtbank', 'firstbank', 'zenith', 'uba', 'fidelity', 'union', 'heritage', 'sterling']
        .includes(bank.slug)
      );

      return ussdBanks.map(bank => ({
        ...bank,
        ussd_code: this.getUSSDCode(bank.slug)
      }));

    } catch (error) {
      logger.error('Failed to get USSD banks:', error);
      throw error;
    }
  }

  /**
   * Get USSD code for bank
   * @param {string} bankSlug - Bank slug
   * @returns {string} USSD code
   */
  getUSSDCode(bankSlug) {
    const ussdCodes = {
      'access': '*901#',
      'gtbank': '*737#',
      'firstbank': '*894#',
      'zenith': '*966#',
      'uba': '*919#',
      'fidelity': '*770#',
      'union': '*826#',
      'heritage': '*745#',
      'sterling': '*822#',
      'fcmb': '*329#',
      'wema': '*945#',
      'polaris': '*833#',
      'stanbic': '*909#'
    };

    return ussdCodes[bankSlug] || '*000#';
  }

  /**
   * Validate Nigerian phone number for mobile money
   * @param {string} phoneNumber - Phone number
   * @returns {Object} Validation result
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

    const prefix = normalized.substring(0, 4);
    const networks = {
      mtn: ['0703', '0706', '0803', '0806', '0810', '0813', '0814', '0816', '0903', '0906'],
      airtel: ['0701', '0708', '0802', '0808', '0812', '0901', '0902', '0907'],
      glo: ['0705', '0805', '0807', '0811', '0815', '0905'],
      '9mobile': ['0809', '0817', '0818', '0908', '0909']
    };

    for (const [network, prefixes] of Object.entries(networks)) {
      if (prefixes.includes(prefix)) {
        return {
          valid: true,
          network: network,
          normalized: normalized
        };
      }
    }

    return {
      valid: false,
      error: 'Unknown network provider'
    };
  }
}

// ================================
// EXPORT SINGLETON INSTANCE
// ================================

let paystackInstance = null;

module.exports = {
  PaystackService,
  
  // Singleton factory
  getInstance: () => {
    if (!paystackInstance) {
      paystackInstance = new PaystackService();
    }
    return paystackInstance;
  },

  // Initialize and return instance
  initialize: async () => {
    return await PaystackService.initialize();
  }
};