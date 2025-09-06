// apps/backend/src/services/FlutterwaveService.js
// Complete Flutterwave payment integration for Nigerian market

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { formatNairaAmount, calculateVoidFee } = require('../utils/paymentUtils');

class FlutterwaveService {
  constructor() {
    this.baseURL = process.env.FLUTTERWAVE_ENV === 'production' 
      ? 'https://api.flutterwave.com/v3'
      : 'https://api.flutterwave.com/v3'; // Same endpoint for sandbox
    
    this.secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
    this.publicKey = process.env.FLUTTERWAVE_PUBLIC_KEY;
    this.encryptionKey = process.env.FLUTTERWAVE_ENCRYPTION_KEY;
    
    if (!this.secretKey) {
      logger.warn('Flutterwave secret key not configured');
    }

    // Nigerian banks for account validation
    this.nigerianBanks = {
      '044': 'Access Bank',
      '063': 'Access Bank (Diamond)',
      '035': 'Wema Bank',
      '011': 'First Bank of Nigeria',
      '058': 'Guaranty Trust Bank',
      '030': 'Heritage Banking Company',
      '082': 'Keystone Bank',
      '221': 'Stanbic IBTC Bank',
      '068': 'Standard Chartered Bank',
      '232': 'Sterling Bank',
      '033': 'United Bank for Africa',
      '032': 'Union Bank of Nigeria',
      '057': 'Zenith Bank',
      '076': 'Polaris Bank',
      '050': 'Ecobank Nigeria',
      '070': 'Fidelity Bank'
    };
  }

  // ================================
  // CORE PAYMENT METHODS
  // ================================

  /**
   * Initialize payment with Flutterwave
   * @param {Object} paymentData - Payment information
   * @returns {Object} Payment initialization response
   */
  async initializePayment(paymentData) {
    try {
      const {
        amount,
        email,
        phone_number,
        name,
        transaction_id,
        redirect_url,
        payment_options = 'card,banktransfer,ussd,mobilemoney',
        currency = 'NGN',
        metadata = {}
      } = paymentData;

      // Calculate fees
      const voidFee = calculateVoidFee(amount);
      const totalAmount = amount + voidFee;

      const payload = {
        tx_ref: transaction_id,
        amount: totalAmount,
        currency,
        redirect_url,
        payment_options,
        customer: {
          email,
          phone_number,
          name
        },
        customizations: {
          title: 'Void Marketplace',
          description: 'Payment for product purchase',
          logo: 'https://voidmarketplace.com/logo.png'
        },
        meta: {
          ...metadata,
          void_fee: voidFee,
          original_amount: amount,
          platform: 'void_marketplace'
        }
      };

      const response = await this.makeRequest('POST', '/payments', payload);

      logger.info('Flutterwave payment initialized', {
        transaction_id,
        amount: totalAmount,
        currency,
        status: response.status
      });

      return {
        success: true,
        data: {
          payment_link: response.data.link,
          access_code: response.data.access_code,
          reference: transaction_id,
          amount: totalAmount,
          void_fee: voidFee,
          expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
        }
      };

    } catch (error) {
      logger.error('Flutterwave payment initialization failed:', error);
      throw new Error(`Payment initialization failed: ${error.message}`);
    }
  }

  /**
   * Verify Flutterwave webhook signature
   * @param {Object} payload - Webhook payload
   * @param {string} signature - Webhook signature header
   * @returns {boolean} Is webhook authentic
   */
  verifyWebhookSignature(payload, signature) {
    try {
      const hash = crypto
        .createHmac('sha256', this.secretKey)
        .update(JSON.stringify(payload))
        .digest('hex');

      return hash === signature;
    } catch (error) {
      logger.error('Webhook signature verification failed:', error);
      return false;
    }
  }

  // ================================
  // NIGERIAN SPECIFIC FEATURES
  // ================================

  /**
   * Get Nigerian banks list
   * @returns {Object} Nigerian banks response
   */
  async getNigerianBanks() {
    try {
      const response = await this.makeRequest('GET', '/banks/NG');
      
      return {
        success: true,
        data: response.data.map(bank => ({
          code: bank.code,
          name: bank.name,
          slug: bank.slug
        }))
      };
    } catch (error) {
      logger.error('Get Nigerian banks failed:', error);
      throw new Error(`Failed to get banks: ${error.message}`);
    }
  }

  /**
   * Get current exchange rates for NGN
   * @returns {Object} Exchange rates response
   */
  async getExchangeRates() {
    try {
      const response = await this.makeRequest('GET', '/forex');
      
      const ngnRates = response.data.filter(rate => 
        rate.source_currency === 'NGN' || rate.destination_currency === 'NGN'
      );

      return {
        success: true,
        data: ngnRates
      };
    } catch (error) {
      logger.error('Get exchange rates failed:', error);
      throw new Error(`Failed to get exchange rates: ${error.message}`);
    }
  }

  /**
   * Validate Nigerian phone number
   * @param {string} phoneNumber - Phone number to validate
   * @returns {boolean} Is phone number valid
   */
  validateNigerianPhoneNumber(phoneNumber) {
    // Nigerian phone number patterns
    const patterns = [
      /^(\+234|234|0)(70|71|80|81|90|91|70|71)\d{8}$/, // MTN
      /^(\+234|234|0)(80|81|90|91)\d{8}$/, // GLO
      /^(\+234|234|0)(80|81|70|71)\d{8}$/, // Airtel
      /^(\+234|234|0)(81|80|90|91)\d{8}$/, // 9mobile
    ];

    return patterns.some(pattern => pattern.test(phoneNumber));
  }

  /**
   * Format Nigerian phone number
   * @param {string} phoneNumber - Phone number to format
   * @returns {string} Formatted phone number
   */
  formatNigerianPhoneNumber(phoneNumber) {
    // Remove all non-numeric characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // Handle different formats
    if (cleaned.startsWith('234')) {
      return `+${cleaned}`;
    } else if (cleaned.startsWith('0')) {
      return `+234${cleaned.substring(1)}`;
    } else if (cleaned.length === 10) {
      return `+234${cleaned}`;
    }
    
    return phoneNumber; // Return original if can't format
  }

  // ================================
  // PAYMENT PLANS & SUBSCRIPTIONS
  // ================================

  /**
   * Create payment plan for subscriptions
   * @param {Object} planData - Payment plan data
   * @returns {Object} Payment plan response
   */
  async createPaymentPlan(planData) {
    try {
      const {
        amount,
        name,
        interval, // daily, weekly, monthly, yearly
        duration = 0, // 0 for indefinite
        currency = 'NGN'
      } = planData;

      const payload = {
        amount,
        name,
        interval,
        duration,
        currency
      };

      const response = await this.makeRequest('POST', '/payment-plans', payload);

      return {
        success: true,
        data: {
          plan_id: response.data.id,
          name: response.data.name,
          amount: response.data.amount,
          interval: response.data.interval,
          duration: response.data.duration,
          status: response.data.status,
          created_at: response.data.created_at
        }
      };

    } catch (error) {
      logger.error('Payment plan creation failed:', error);
      throw new Error(`Payment plan creation failed: ${error.message}`);
    }
  }

  /**
   * Subscribe customer to payment plan
   * @param {Object} subscriptionData - Subscription data
   * @returns {Object} Subscription response
   */
  async createSubscription(subscriptionData) {
    try {
      const {
        customer_email,
        plan_id,
        customer_name,
        customer_phone
      } = subscriptionData;

      const payload = {
        customer: customer_email,
        plan: plan_id,
        customer_name,
        customer_phone
      };

      const response = await this.makeRequest('POST', '/subscriptions', payload);

      return {
        success: true,
        data: {
          subscription_id: response.data.id,
          customer: response.data.customer,
          plan: response.data.plan,
          status: response.data.status,
          amount: response.data.amount,
          created_at: response.data.created_at
        }
      };

    } catch (error) {
      logger.error('Subscription creation failed:', error);
      throw new Error(`Subscription creation failed: ${error.message}`);
    }
  }

  // ================================
  // REFUNDS & CHARGEBACKS
  // ================================

  /**
   * Process refund
   * @param {Object} refundData - Refund information
   * @returns {Object} Refund response
   */
  async processRefund(refundData) {
    try {
      const {
        transaction_id,
        amount,
        comments = 'Refund processed via Void Marketplace'
      } = refundData;

      const payload = {
        amount,
        comments
      };

      const response = await this.makeRequest('POST', `/transactions/${transaction_id}/refund`, payload);

      logger.info('Refund processed', {
        transaction_id,
        refund_id: response.data.id,
        amount: response.data.amount,
        status: response.data.status
      });

      return {
        success: true,
        data: {
          refund_id: response.data.id,
          transaction_id: response.data.transaction_id,
          amount: response.data.amount,
          status: response.data.status,
          comment: response.data.comment,
          created_at: response.data.created_at
        }
      };

    } catch (error) {
      logger.error('Refund processing failed:', error);
      throw new Error(`Refund failed: ${error.message}`);
    }
  }

  // ================================
  // ANALYTICS & REPORTING
  // ================================

  /**
   * Get transaction analytics
   * @param {Object} analyticsParams - Analytics parameters
   * @returns {Object} Analytics response
   */
  async getTransactionAnalytics(analyticsParams) {
    try {
      const {
        from,
        to,
        currency = 'NGN'
      } = analyticsParams;

      const response = await this.makeRequest('GET', '/transactions', {
        from,
        to,
        currency,
        status: 'successful'
      });

      const transactions = response.data;
      
      // Calculate analytics
      const totalVolume = transactions.reduce((sum, tx) => sum + tx.amount, 0);
      const totalCount = transactions.length;
      const averageTransaction = totalCount > 0 ? totalVolume / totalCount : 0;
      
      // Group by payment method
      const paymentMethodBreakdown = transactions.reduce((acc, tx) => {
        const method = tx.payment_type || 'unknown';
        acc[method] = (acc[method] || 0) + tx.amount;
        return acc;
      }, {});

      return {
        success: true,
        data: {
          period: { from, to },
          total_volume: totalVolume,
          total_count: totalCount,
          average_transaction: averageTransaction,
          payment_methods: paymentMethodBreakdown,
          currency
        }
      };

    } catch (error) {
      logger.error('Transaction analytics failed:', error);
      throw new Error(`Analytics failed: ${error.message}`);
    }
  }

  // ================================
  // UTILITY METHODS
  // ================================

  /**
   * Make authenticated request to Flutterwave API
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data
   * @returns {Object} API response
   */
  async makeRequest(method, endpoint, data = null) {
    try {
      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json'
        }
      };

      if (data && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
        config.data = data;
      } else if (data && method.toUpperCase() === 'GET') {
        config.params = data;
      }

      const response = await axios(config);
      
      if (response.data.status === 'error') {
        throw new Error(response.data.message || 'Flutterwave API error');
      }

      return response.data;

    } catch (error) {
      if (error.response) {
        logger.error('Flutterwave API error:', {
          status: error.response.status,
          data: error.response.data,
          endpoint
        });
        throw new Error(error.response.data.message || 'Flutterwave API error');
      } else if (error.request) {
        logger.error('Flutterwave network error:', error.message);
        throw new Error('Network error connecting to Flutterwave');
      } else {
        logger.error('Flutterwave service error:', error.message);
        throw error;
      }
    }
  }

  /**
   * Health check for Flutterwave service
   * @returns {Object} Health status
   */
  async healthCheck() {
    try {
      await this.makeRequest('GET', '/banks/NG');
      return {
        service: 'flutterwave',
        status: 'healthy',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        service: 'flutterwave',
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // ================================
  // NIGERIAN SPECIFIC INTEGRATIONS
  // ================================

  /**
   * Get Nigerian mobile network operators
   * @returns {Array} List of Nigerian mobile networks
   */
  getNigerianNetworks() {
    return [
      {
        code: 'MTN',
        name: 'MTN Nigeria',
        prefixes: ['0803', '0806', '0813', '0816', '0810', '0814', '0903', '0906', '0913', '0916'],
        ussd_code: '*311#'
      },
      {
        code: 'GLO',
        name: 'Globacom Nigeria',
        prefixes: ['0805', '0807', '0815', '0811', '0905', '0915'],
        ussd_code: '*777#'
      },
      {
        code: 'AIRTEL',
        name: 'Airtel Nigeria',
        prefixes: ['0802', '0808', '0812', '0701', '0902', '0907', '0901', '0904', '0912'],
        ussd_code: '*140#'
      },
      {
        code: '9MOBILE',
        name: '9mobile Nigeria',
        prefixes: ['0809', '0817', '0818', '0908', '0909'],
        ussd_code: '*200#'
      }
    ];
  }

  /**
   * Detect network from phone number
   * @param {string} phoneNumber - Nigerian phone number
   * @returns {Object|null} Network information
   */
  detectNetworkFromPhoneNumber(phoneNumber) {
    const networks = this.getNigerianNetworks();
    const cleanedNumber = phoneNumber.replace(/\D/g, '');
    
    // Extract prefix (first 4 digits after country code)
    let prefix;
    if (cleanedNumber.startsWith('234')) {
      prefix = '0' + cleanedNumber.substring(3, 6);
    } else if (cleanedNumber.startsWith('0')) {
      prefix = cleanedNumber.substring(0, 4);
    } else if (cleanedNumber.length === 10) {
      prefix = '0' + cleanedNumber.substring(0, 3);
    } else {
      return null;
    }

    // Find matching network
    return networks.find(network => 
      network.prefixes.includes(prefix)
    ) || null;
  }

  /**
   * Generate Nigerian bank transfer instructions
   * @param {Object} transferData - Transfer details
   * @returns {Object} Transfer instructions
   */
  generateBankTransferInstructions(transferData) {
    const {
      amount,
      account_number,
      account_name,
      bank_name,
      reference
    } = transferData;

    return {
      instructions: [
        '1. Log into your mobile banking app or visit any branch',
        '2. Select "Transfer to Other Banks"',
        '3. Enter the following details:',
        `   • Account Number: ${account_number}`,
        `   • Account Name: ${account_name}`,
        `   • Bank: ${bank_name}`,
        `   • Amount: ₦${formatNairaAmount(amount)}`,
        `   • Narration: ${reference}`,
        '4. Confirm and complete the transfer',
        '5. Your order will be processed once payment is confirmed'
      ],
      estimated_time: '5-15 minutes',
      important_notes: [
        'Double-check account details before sending',
        'Keep your transaction receipt',
        'Payment confirmation may take up to 30 minutes',
        'Contact support if payment is not reflected after 1 hour'
      ]
    };
  }

  /**
   * Process wallet-to-wallet transfer
   * @param {Object} walletData - Wallet transfer data
   * @returns {Object} Transfer response
   */
  async processWalletTransfer(walletData) {
    try {
      const {
        amount,
        recipient_wallet_id,
        sender_wallet_id,
        pin,
        narration = 'Void Marketplace payment'
      } = walletData;

      const payload = {
        amount,
        currency: 'NGN',
        recipient: recipient_wallet_id,
        sender: sender_wallet_id,
        pin,
        narration
      };

      const response = await this.makeRequest('POST', '/wallet-transfers', payload);

      return {
        success: true,
        data: {
          transfer_id: response.data.id,
          status: response.data.status,
          amount: response.data.amount,
          fee: response.data.fee,
          reference: response.data.reference,
          created_at: response.data.created_at
        }
      };

    } catch (error) {
      logger.error('Wallet transfer failed:', error);
      throw new Error(`Wallet transfer failed: ${error.message}`);
    }
  }

  /**
   * Get Nigerian states and local governments
   * @returns {Array} Nigerian geographical data
   */
  getNigerianStatesAndLGAs() {
    return {
      'Abia': ['Aba North', 'Aba South', 'Arochukwu', 'Bende', 'Ikwuano', 'Isiala Ngwa North', 'Isiala Ngwa South', 'Isuikwuato', 'Obi Ngwa', 'Ohafia', 'Osisioma', 'Ugwunagbo', 'Ukwa East', 'Ukwa West', 'Umuahia North', 'Umuahia South', 'Umu Nneochi'],
      'Adamawa': ['Demsa', 'Fufure', 'Ganye', 'Gayuk', 'Gombi', 'Grie', 'Hong', 'Jada', 'Larmurde', 'Madagali', 'Maiha', 'Mayo Belwa', 'Michika', 'Mubi North', 'Mubi South', 'Numan', 'Shelleng', 'Song', 'Toungo', 'Yola North', 'Yola South'],
      'Akwa Ibom': ['Abak', 'Eastern Obolo', 'Eket', 'Esit Eket', 'Essien Udim', 'Etim Ekpo', 'Etinan', 'Ibeno', 'Ibesikpo Asutan', 'Ibiono-Ibom', 'Ika', 'Ikono', 'Ikot Abasi', 'Ikot Ekpene', 'Ini', 'Itu', 'Mbo', 'Mkpat-Enin', 'Nsit-Atai', 'Nsit-Ibom', 'Nsit-Ubium', 'Obot Akara', 'Okobo', 'Onna', 'Oron', 'Oruk Anam', 'Udung-Uko', 'Ukanafun', 'Uruan', 'Urue-Offong/Oruko', 'Uyo'],
      'Lagos': ['Agege', 'Ajeromi-Ifelodun', 'Alimosho', 'Amuwo-Odofin', 'Apapa', 'Badagry', 'Epe', 'Eti Osa', 'Ibeju-Lekki', 'Ifako-Ijaiye', 'Ikeja', 'Ikorodu', 'Kosofe', 'Lagos Island', 'Lagos Mainland', 'Mushin', 'Ojo', 'Oshodi-Isolo', 'Shomolu', 'Surulere'],
      // Add more states as needed...
    };
  }

  /**
   * Validate Nigerian BVN (Bank Verification Number)
   * @param {string} bvn - BVN to validate
   * @returns {boolean} Is BVN format valid
   */
  validateBVN(bvn) {
    // BVN should be exactly 11 digits
    return /^\d{11}$/.test(bvn);
  }

  /**
   * Generate payment reminder SMS
   * @param {Object} reminderData - Reminder details
   * @returns {string} SMS message
   */
  generatePaymentReminderSMS(reminderData) {
    const {
      customer_name,
      amount,
      due_date,
      payment_link,
      merchant_name = 'Void Marketplace'
    } = reminderData;

    return `Hello ${customer_name}, this is a reminder that your payment of ₦${formatNairaAmount(amount)} to ${merchant_name} is due on ${due_date}. Pay now: ${payment_link}`;
  }

  /**
   * Calculate Nigerian business days (excluding weekends and public holidays)
   * @param {Date} startDate - Start date
   * @param {number} businessDays - Number of business days to add
   * @returns {Date} End date
   */
  calculateNigerianBusinessDays(startDate, businessDays) {
    const nigerianPublicHolidays2024 = [
      '2024-01-01', // New Year's Day
      '2024-04-01', // Easter Monday
      '2024-05-01', // Workers' Day
      '2024-06-12', // Democracy Day
      '2024-10-01', // Independence Day
      '2024-12-25', // Christmas Day
      '2024-12-26', // Boxing Day
      // Add Islamic holidays (dates vary by year)
    ];

    let currentDate = new Date(startDate);
    let daysAdded = 0;

    while (daysAdded < businessDays) {
      currentDate.setDate(currentDate.getDate() + 1);
      
      // Check if it's a weekend (Saturday = 6, Sunday = 0)
      if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
        // Check if it's not a public holiday
        const dateString = currentDate.toISOString().split('T')[0];
        if (!nigerianPublicHolidays2024.includes(dateString)) {
          daysAdded++;
        }
      }
    }

    return currentDate;
  }

  // ================================
  // BULK OPERATIONS
  // ================================

  /**
   * Process bulk transfers to multiple recipients
   * @param {Array} transfers - Array of transfer objects
   * @returns {Object} Bulk transfer results
   */
  async processBulkTransfers(transfers) {
    try {
      const payload = {
        title: `Void Marketplace Bulk Transfer - ${new Date().toISOString().split('T')[0]}`,
        bulk_data: transfers.map(transfer => ({
          bank_code: transfer.account_bank,
              account_number: transfer.account_number,
              amount: transfer.amount,
              currency: 'NGN',
              narration: transfer.narration || 'Void Marketplace payout',
              reference: transfer.reference || `bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            }))
          };

      const response = await this.makeRequest('POST', '/bulk-transfers', payload);

      return {
        success: true,
        data: {
          batch_id: response.data.id,
          status: response.data.status,
          total_amount: response.data.total_amount,
          total_fee: response.data.total_fee,
          created_at: response.data.created_at,
          transfers: response.data.transfers
        }
      };

    } catch (error) {
      logger.error('Bulk transfers failed:', error);
      throw new Error(`Bulk transfers failed: ${error.message}`);
    }
  }

  /**
   * Get bulk transfer status
   * @param {string} batchId - Bulk transfer batch ID
   * @returns {Object} Batch status
   */
  async getBulkTransferStatus(batchId) {
    try {
      const response = await this.makeRequest('GET', `/bulk-transfers/${batchId}`);

      return {
        success: true,
        data: {
          batch_id: response.data.id,
          status: response.data.status,
          total_amount: response.data.total_amount,
          successful_transfers: response.data.successful_transfers,
          failed_transfers: response.data.failed_transfers,
          created_at: response.data.created_at,
          completed_at: response.data.completed_at
        }
      };

    } catch (error) {
      logger.error('Get bulk transfer status failed:', error);
      throw new Error(`Failed to get bulk transfer status: ${error.message}`);
    }
  }

  // ================================
  // CURRENCY CONVERSION
  // ================================

  /**
   * Convert currency amounts
   * @param {Object} conversionData - Conversion parameters
   * @returns {Object} Conversion result
   */
  async convertCurrency(conversionData) {
    try {
      const {
        amount,
        from_currency,
        to_currency = 'NGN'
      } = conversionData;

      const response = await this.makeRequest('GET', `/forex`, {
        from: from_currency,
        to: to_currency,
        amount
      });

      return {
        success: true,
        data: {
          original_amount: amount,
          converted_amount: response.data.converted_amount,
          from_currency,
          to_currency,
          exchange_rate: response.data.rate,
          conversion_date: new Date().toISOString()
        }
      };

    } catch (error) {
      logger.error('Currency conversion failed:', error);
      throw new Error(`Currency conversion failed: ${error.message}`);
    }
  }

  // ================================
  // DISPUTE MANAGEMENT
  // ================================

  /**
   * Handle payment disputes
   * @param {Object} disputeData - Dispute information
   * @returns {Object} Dispute response
   */
  async handlePaymentDispute(disputeData) {
    try {
      const {
        transaction_id,
        dispute_reason,
        customer_email,
        customer_phone,
        evidence_files = []
      } = disputeData;

      // Flutterwave typically handles disputes through their dashboard
      // This method would integrate with their dispute API when available
      logger.info('Payment dispute submitted', {
        transaction_id,
        dispute_reason,
        customer_email
      });

      return {
        success: true,
        data: {
          dispute_id: `dispute_${Date.now()}`,
          status: 'submitted',
          transaction_id,
          dispute_reason,
          submitted_at: new Date().toISOString(),
          expected_resolution_time: '5-7 business days'
        }
      };

    } catch (error) {
      logger.error('Handle payment dispute failed:', error);
      throw new Error(`Dispute handling failed: ${error.message}`);
    }
  }

  // ================================
  // COMPLIANCE & KYC
  // ================================

  /**
   * Verify customer identity (KYC)
   * @param {Object} kycData - KYC information
   * @returns {Object} Verification result
   */
  async verifyCustomerKYC(kycData) {
    try {
      const {
        customer_id,
        first_name,
        last_name,
        email,
        phone,
        date_of_birth,
        bvn,
        identity_type, // bvn, nin, passport, drivers_license
        identity_number
      } = kycData;

      // This would integrate with Flutterwave's KYC verification API
      // Currently simulating the response
      const verification_result = {
        customer_id,
        verification_status: 'pending',
        verified_fields: {
          name: true,
          email: true,
          phone: true,
          identity: false // Pending verification
        },
        verification_id: `kyc_${Date.now()}`,
        submitted_at: new Date().toISOString()
      };

      logger.info('KYC verification initiated', {
        customer_id,
        identity_type,
        verification_id: verification_result.verification_id
      });

      return {
        success: true,
        data: verification_result
      };

    } catch (error) {
      logger.error('KYC verification failed:', error);
      throw new Error(`KYC verification failed: ${error.message}`);
    }
  }

  // ================================
  // BUSINESS ACCOUNT MANAGEMENT
  // ================================

  /**
   * Create business sub-account for vendors
   * @param {Object} businessData - Business account data
   * @returns {Object} Sub-account details
   */
  async createBusinessSubAccount(businessData) {
    try {
      const {
        business_name,
        business_email,
        business_contact,
        business_mobile,
        split_type = 'percentage',
        split_value = 2.5, // 2.5% platform fee
        bank_code,
        account_number,
        business_address,
        rc_number, // Registration certificate number
        documents = []
      } = businessData;

      const payload = {
        business_name,
        business_email,
        business_contact,
        business_mobile,
        split_type,
        split_value,
        settlement_bank: bank_code,
        account_number,
        business_address,
        documents
      };

      const response = await this.makeRequest('POST', '/subaccounts', payload);

      logger.info('Business sub-account created', {
        business_name,
        subaccount_id: response.data.subaccount_id,
        split_value
      });

      return {
        success: true,
        data: {
          subaccount_id: response.data.subaccount_id,
          business_name: response.data.business_name,
          split_type: response.data.split_type,
          split_value: response.data.split_value,
          status: response.data.status,
          created_at: response.data.created_at
        }
      };

    } catch (error) {
      logger.error('Create business sub-account failed:', error);
      throw new Error(`Business sub-account creation failed: ${error.message}`);
    }
  }

  /**
   * Update business sub-account
   * @param {Object} updateData - Update parameters
   * @returns {Object} Update result
   */
  async updateBusinessSubAccount(updateData) {
    try {
      const {
        subaccount_id,
        business_name,
        business_email,
        split_value,
        bank_code,
        account_number
      } = updateData;

      const payload = {};
      if (business_name) payload.business_name = business_name;
      if (business_email) payload.business_email = business_email;
      if (split_value) payload.split_value = split_value;
      if (bank_code) payload.settlement_bank = bank_code;
      if (account_number) payload.account_number = account_number;

      const response = await this.makeRequest('PUT', `/subaccounts/${subaccount_id}`, payload);

      return {
        success: true,
        data: response.data
      };

    } catch (error) {
      logger.error('Update business sub-account failed:', error);
      throw new Error(`Business sub-account update failed: ${error.message}`);
    }
  }

  /**
   * Verify Flutterwave payment transaction
   * @param {string} transactionId - Transaction reference
   * @returns {Object} Payment verification result
   */
  async verifyPayment(transactionId) {
    try {
      const response = await this.makeRequest('GET', `/transactions/${transactionId}/verify`);
      
      const transaction = response.data;
      const isSuccess = transaction.status === 'successful';

      logger.info('Flutterwave payment verification', {
        transaction_id: transactionId,
        status: transaction.status,
        amount: transaction.amount,
        success: isSuccess
      });

      return {
        success: isSuccess,
        data: {
          reference: transaction.tx_ref,
          amount: transaction.amount,
          currency: transaction.currency,
          status: transaction.status,
          payment_type: transaction.payment_type,
          transaction_id: transaction.id,
          customer: transaction.customer,
          charged_amount: transaction.charged_amount,
          app_fee: transaction.app_fee,
          merchant_fee: transaction.merchant_fee,
          processor_response: transaction.processor_response,
          auth_model: transaction.card?.auth_model,
          card_details: transaction.card ? {
            first_4digits: transaction.card.first_4digits,
            last_4digits: transaction.card.last_4digits,
            brand: transaction.card.brand,
            country: transaction.card.country
          } : null,
          meta: transaction.meta
        }
      };

    } catch (error) {
      logger.error('Flutterwave payment verification failed:', error);
      throw new Error(`Payment verification failed: ${error.message}`);
    }
  }

  // ================================
  // NIGERIAN MOBILE MONEY INTEGRATION
  // ================================

  /**
   * Process mobile money payment (MTN, Airtel, etc.)
   * @param {Object} mobileMoneyData - Mobile money payment data
   * @returns {Object} Mobile money payment response
   */
  async processMobileMoneyPayment(mobileMoneyData) {
    try {
      const {
        amount,
        phone_number,
        email,
        network, // MTN, AIRTEL, GLO, 9MOBILE
        transaction_id,
        customer_name
      } = mobileMoneyData;

      const voidFee = calculateVoidFee(amount);
      const totalAmount = amount + voidFee;

      const payload = {
        tx_ref: transaction_id,
        amount: totalAmount,
        currency: 'NGN',
        email,
        phone_number,
        network: network.toUpperCase(),
        type: 'mobilemoney',
        meta: {
          void_fee: voidFee,
          original_amount: amount,
          network: network.toUpperCase()
        }
      };

      const response = await this.makeRequest('POST', '/charges?type=mobilemoney', payload);

      // Handle OTP validation for mobile money
      if (response.data.status === 'pending' && response.data.validation_required) {
        return {
          success: true,
          requires_otp: true,
          data: {
            flw_ref: response.data.flw_ref,
            tx_ref: transaction_id,
            validation_instructions: response.data.processor_response,
            amount: totalAmount
          }
        };
      }

      return {
        success: response.data.status === 'successful',
        data: {
          reference: transaction_id,
          flw_ref: response.data.flw_ref,
          status: response.data.status,
          amount: totalAmount,
          processor_response: response.data.processor_response
        }
      };

    } catch (error) {
      logger.error('Flutterwave mobile money payment failed:', error);
      throw new Error(`Mobile money payment failed: ${error.message}`);
    }
  }

  /**
   * Validate mobile money OTP
   * @param {Object} otpData - OTP validation data
   * @returns {Object} OTP validation response
   */
  async validateMobileMoneyOTP(otpData) {
    try {
      const { flw_ref, otp } = otpData;

      const payload = { otp, flw_ref };
      const response = await this.makeRequest('POST', '/validate-charge', payload);

      return {
        success: response.data.status === 'successful',
        data: {
          status: response.data.status,
          flw_ref: response.data.flw_ref,
          tx_ref: response.data.tx_ref,
          processor_response: response.data.processor_response
        }
      };

    } catch (error) {
      logger.error('Flutterwave mobile money OTP validation failed:', error);
      throw new Error(`OTP validation failed: ${error.message}`);
    }
  }

  // ================================
  // NIGERIAN BANK TRANSFER INTEGRATION
  // ================================

  /**
   * Generate virtual account for bank transfer
   * @param {Object} accountData - Virtual account data
   * @returns {Object} Virtual account details
   */
  async createVirtualAccount(accountData) {
    try {
      const {
        email,
        phone_number,
        first_name,
        last_name,
        transaction_id,
        amount,
        duration = 24 // hours
      } = accountData;

      const voidFee = calculateVoidFee(amount);
      const totalAmount = amount + voidFee;

      const payload = {
        email,
        phone_number,
        first_name,
        last_name,
        narration: `Payment for Void Marketplace - ${transaction_id}`,
        tx_ref: transaction_id,
        amount: totalAmount,
        currency: 'NGN',
        duration,
        frequency: 1 // One-time payment
      };

      const response = await this.makeRequest('POST', '/virtual-account-numbers', payload);

      logger.info('Virtual account created', {
        transaction_id,
        account_number: response.data.account_number,
        bank_name: response.data.bank_name,
        amount: totalAmount
      });

      return {
        success: true,
        data: {
          account_number: response.data.account_number,
          account_reference: response.data.account_reference,
          bank_name: response.data.bank_name,
          bank_code: response.data.bank_code,
          amount: totalAmount,
          expires_at: new Date(Date.now() + duration * 60 * 60 * 1000),
          tx_ref: transaction_id
        }
      };

    } catch (error) {
      logger.error('Virtual account creation failed:', error);
      throw new Error(`Virtual account creation failed: ${error.message}`);
    }
  }

  // ================================
  // USSD PAYMENT INTEGRATION
  // ================================

  /**
   * Generate USSD payment code
   * @param {Object} ussdData - USSD payment data
   * @returns {Object} USSD payment response
   */
  async generateUSSDPayment(ussdData) {
    try {
      const {
        amount,
        email,
        phone_number,
        transaction_id,
        account_bank, // Bank code (e.g., '058' for GTB)
        customer_name
      } = ussdData;

      const voidFee = calculateVoidFee(amount);
      const totalAmount = amount + voidFee;

      const payload = {
        tx_ref: transaction_id,
        account_bank,
        amount: totalAmount,
        currency: 'NGN',
        email,
        phone_number,
        type: 'ussd'
      };

      const response = await this.makeRequest('POST', '/charges?type=ussd', payload);

      const bankName = this.nigerianBanks[account_bank] || 'Unknown Bank';

      return {
        success: true,
        data: {
          ussd_code: response.data.meta.authorization.note,
          bank_name: bankName,
          bank_code: account_bank,
          amount: totalAmount,
          reference: transaction_id,
          instructions: `Dial ${response.data.meta.authorization.note} on your phone`,
          expires_at: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
        }
      };

    } catch (error) {
      logger.error('USSD payment generation failed:', error);
      throw new Error(`USSD payment failed: ${error.message}`);
    }
  }

  // ================================
  // VENDOR PAYOUTS & TRANSFERS
  // ================================

  /**
   * Transfer funds to vendor account
   * @param {Object} transferData - Transfer information
   * @returns {Object} Transfer response
   */
  async transferToVendor(transferData) {
    try {
      const {
        amount,
        account_number,
        account_bank,
        vendor_name,
        vendor_email,
        reference,
        narration = 'Void Marketplace payout'
      } = transferData;

      const payload = {
        account_bank,
        account_number,
        amount,
        currency: 'NGN',
        reference,
        narration,
        callback_url: `${process.env.API_BASE_URL}/webhooks/flutterwave/transfer`,
        beneficiary_name: vendor_name
      };

      const response = await this.makeRequest('POST', '/transfers', payload);

      logger.info('Vendor transfer initiated', {
        reference,
        amount,
        account_number: account_number.replace(/\d(?=\d{4})/g, '*'),
        status: response.data.status
      });

      return {
        success: true,
        data: {
          transfer_id: response.data.id,
          reference: response.data.reference,
          status: response.data.status,
          amount: response.data.amount,
          fee: response.data.fee,
          account_number: response.data.account_number,
          bank_name: response.data.bank_name,
          created_at: response.data.created_at
        }
      };

    } catch (error) {
      logger.error('Vendor transfer failed:', error);
      throw new Error(`Transfer failed: ${error.message}`);
    }
  }

  /**
   * Verify bank account details
   * @param {Object} accountData - Account verification data
   * @returns {Object} Account verification response
   */
  async verifyBankAccount(accountData) {
    try {
      const { account_number, account_bank } = accountData;

      const response = await this.makeRequest('POST', '/accounts/resolve', {
        account_number,
        account_bank
      });

      return {
        success: true,
        data: {
          account_number: response.data.account_number,
          account_name: response.data.account_name,
          bank_name: this.nigerianBanks[account_bank] || 'Unknown Bank',
          bank_code: account_bank
        }
      };

    } catch (error) {
      logger.error('Bank account verification failed:', error);
      return {
        success: false,
        error: 'Invalid account details'
      };
    }
  }

  // ================================
  // WEBHOOK VERIFICATION
  // ================================

  /**
   * Verify webhook signature for Flutterwave
   * @param {Object} payload - Webhook payload
   * @param {string} signature - Webhook signature
   * @returns {boolean} Is signature valid
   */
  verifyWebhook(payload, signature) {
    return this.verifyWebhookSignature(payload, signature);
  }
}

module.exports = FlutterwaveService;