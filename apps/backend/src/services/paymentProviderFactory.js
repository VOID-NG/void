// apps/backend/src/services/PaymentProviderFactory.js
// Payment provider factory with automatic selection, fallback, and load balancing

const logger = require('../utils/logger');
const { 
  PAYMENT_PROVIDERS, 
  PAYMENT_METHODS,
  PROVIDER_CONFIGS,
  calculatePaymentFees,
  selectPaymentProvider 
} = require('../config/paymentConfig');

class PaymentProviderFactory {
  constructor() {
    this.providers = new Map();
    this.healthStatus = new Map();
    this.lastHealthCheck = new Map();
    this.fallbackOrder = [
      PAYMENT_PROVIDERS.PAYSTACK,
      PAYMENT_PROVIDERS.FLUTTERWAVE,
      PAYMENT_PROVIDERS.OPAY
    ];
    this.isInitialized = false;
  }

  // ================================
  // INITIALIZATION
  // ================================

  /**
   * Initialize all payment providers
   */
  async initialize() {
    try {
      logger.info('🏭 Initializing Payment Provider Factory...');

      // Initialize Paystack
      if (process.env.PAYSTACK_SECRET_KEY) {
        const PaystackService = require('./paystackService');
        const paystack = await PaystackService.initialize();
        this.providers.set(PAYMENT_PROVIDERS.PAYSTACK, paystack);
        this.healthStatus.set(PAYMENT_PROVIDERS.PAYSTACK, true);
        logger.info('✅ Paystack provider loaded');
      }

      // Initialize Flutterwave
      if (process.env.FLUTTERWAVE_SECRET_KEY) {
        const FlutterwaveService = require('./FlutterwaveService');
        const flutterwave = await FlutterwaveService.initialize();
        this.providers.set(PAYMENT_PROVIDERS.FLUTTERWAVE, flutterwave);
        this.healthStatus.set(PAYMENT_PROVIDERS.FLUTTERWAVE, true);
        logger.info('✅ Flutterwave provider loaded');
      }

      // Initialize Opay
      if (process.env.OPAY_MERCHANT_ID) {
        const OpayService = require('./OpayService');
        const opay = await OpayService.initialize();
        this.providers.set(PAYMENT_PROVIDERS.OPAY, opay);
        this.healthStatus.set(PAYMENT_PROVIDERS.OPAY, true);
        logger.info('✅ Opay provider loaded');
      }

      if (this.providers.size === 0) {
        throw new Error('No payment providers configured');
      }

      // Start health monitoring
      this.startHealthMonitoring();
      this.isInitialized = true;

      logger.info(`🎉 Payment Provider Factory initialized with ${this.providers.size} providers`);
      return this;

    } catch (error) {
      logger.error('❌ Payment Provider Factory initialization failed:', error);
      throw error;
    }
  }

  // ================================
  // PROVIDER SELECTION
  // ================================

  /**
   * Get optimal provider for payment
   */
  async getProvider(criteria = {}) {
    const {
      amount = 0,
      paymentMethod = PAYMENT_METHODS.CARD,
      excludeProviders = [],
      preferredProvider = null,
      userLocation = 'NG',
      vendorPreferences = null
    } = criteria;

    try {
      // If preferred provider is specified and healthy, use it
      if (preferredProvider && this.isProviderHealthy(preferredProvider)) {
        const provider = this.providers.get(preferredProvider);
        if (provider && !excludeProviders.includes(preferredProvider)) {
          logger.debug(`Using preferred provider: ${preferredProvider}`);
          return { provider, name: preferredProvider };
        }
      }

      // Smart selection based on criteria
      const selectedProvider = await this.selectOptimalProvider({
        amount,
        paymentMethod,
        excludeProviders,
        userLocation,
        vendorPreferences
      });

      if (!selectedProvider) {
        throw new Error('No available payment provider found');
      }

      return selectedProvider;

    } catch (error) {
      logger.error('Provider selection failed:', error);
      throw error;
    }
  }

  /**
   * Select optimal provider using advanced logic
   */
  async selectOptimalProvider(criteria) {
    const {
      amount,
      paymentMethod,
      excludeProviders,
      userLocation,
      vendorPreferences
    } = criteria;

    // Get healthy providers that support the payment method
    const candidates = this.getHealthyProviders()
      .filter(([name, provider]) => {
        if (excludeProviders.includes(name)) return false;
        
        const config = PROVIDER_CONFIGS[name];
        return config && config.supportedMethods.includes(paymentMethod);
      });

    if (candidates.length === 0) {
      return null;
    }

    // Score each provider
    const scoredProviders = candidates.map(([name, provider]) => ({
      name,
      provider,
      score: this.calculateProviderScore(name, criteria)
    }));

    // Sort by score (highest first)
    scoredProviders.sort((a, b) => b.score - a.score);

    logger.debug('Provider selection scores:', 
      scoredProviders.map(p => ({ name: p.name, score: p.score }))
    );

    return {
      provider: scoredProviders[0].provider,
      name: scoredProviders[0].name
    };
  }

  /**
   * Calculate provider score based on multiple factors
   */
  calculateProviderScore(providerName, criteria) {
    const { amount, paymentMethod, userLocation } = criteria;
    const config = PROVIDER_CONFIGS[providerName];
    let score = 0;

    // Base score
    score += 100;

    // Fee optimization (lower fees = higher score)
    try {
      const fees = calculatePaymentFees(amount * 100, providerName, paymentMethod); // Convert to kobo
      const feePercentage = (fees.totalFee / fees.grossAmount) * 100;
      score += Math.max(0, 10 - feePercentage); // Max 10 points for lowest fees
    } catch (error) {
      // If fee calculation fails, don't penalize
    }

    // Success rate bonus (mock data - in production, use real metrics)
    const successRates = {
      [PAYMENT_PROVIDERS.PAYSTACK]: 0.98,
      [PAYMENT_PROVIDERS.FLUTTERWAVE]: 0.95,
      [PAYMENT_PROVIDERS.OPAY]: 0.92
    };
    score += (successRates[providerName] || 0.9) * 20; // Max 20 points

    // Method-specific bonuses
    const methodBonuses = {
      [PAYMENT_PROVIDERS.PAYSTACK]: {
        [PAYMENT_METHODS.CARD]: 10,
        [PAYMENT_METHODS.BANK_TRANSFER]: 8,
        [PAYMENT_METHODS.USSD]: 6
      },
      [PAYMENT_PROVIDERS.FLUTTERWAVE]: {
        [PAYMENT_METHODS.CARD]: 9,
        [PAYMENT_METHODS.MOBILE_MONEY]: 10,
        [PAYMENT_METHODS.BANK_TRANSFER]: 7
      },
      [PAYMENT_PROVIDERS.OPAY]: {
        [PAYMENT_METHODS.WALLET]: 10,
        [PAYMENT_METHODS.QR_CODE]: 9,
        [PAYMENT_METHODS.CARD]: 6
      }
    };

    if (methodBonuses[providerName] && methodBonuses[providerName][paymentMethod]) {
      score += methodBonuses[providerName][paymentMethod];
    }

    // Settlement speed bonus
    if (config.settlement?.instant) {
      score += 5;
    } else if (config.settlement?.t1) {
      score += 3;
    }

    // Amount-based optimization
    if (amount < 500000) { // Less than ₦5,000
      // Favor providers with lower flat fees for small amounts
      if (config.fees.flatFee === 0) {
        score += 5;
      }
    } else {
      // Favor providers with caps for large amounts
      if (config.fees.cap) {
        score += 5;
      }
    }

    return score;
  }

  // ================================
  // HEALTH MONITORING
  // ================================

  /**
   * Check if provider is healthy
   */
  isProviderHealthy(providerName) {
    return this.healthStatus.get(providerName) === true;
  }

  /**
   * Get all healthy providers
   */
  getHealthyProviders() {
    return Array.from(this.providers.entries())
      .filter(([name]) => this.isProviderHealthy(name));
  }

  /**
   * Start health monitoring for all providers
   */
  startHealthMonitoring() {
    // Check health every 5 minutes
    setInterval(() => {
      this.checkAllProvidersHealth();
    }, 5 * 60 * 1000);

    // Initial health check
    setTimeout(() => {
      this.checkAllProvidersHealth();
    }, 10000); // 10 seconds after startup
  }

  /**
   * Check health of all providers
   */
  async checkAllProvidersHealth() {
    logger.debug('🏥 Starting provider health check...');

    const healthPromises = Array.from(this.providers.entries()).map(
      ([name, provider]) => this.checkProviderHealth(name, provider)
    );

    await Promise.allSettled(healthPromises);

    const healthyCount = Array.from(this.healthStatus.values())
      .filter(status => status === true).length;

    logger.info(`🏥 Health check complete: ${healthyCount}/${this.providers.size} providers healthy`);
  }

  /**
   * Check health of specific provider
   */
  async checkProviderHealth(providerName, provider) {
    try {
      // Simple health check - verify credentials
      if (typeof provider.verifyCredentials === 'function') {
        await provider.verifyCredentials();
        this.healthStatus.set(providerName, true);
        this.lastHealthCheck.set(providerName, new Date());
        logger.debug(`✅ ${providerName} health check passed`);
      } else {
        // Fallback for providers without health check method
        this.healthStatus.set(providerName, true);
      }
    } catch (error) {
      this.healthStatus.set(providerName, false);
      this.lastHealthCheck.set(providerName, new Date());
      logger.warn(`❌ ${providerName} health check failed:`, error.message);
    }
  }

  // ================================
  // FALLBACK HANDLING
  // ================================

  /**
   * Get fallback provider when primary fails
   */
  async getFallbackProvider(failedProvider, criteria = {}) {
    const excludeProviders = [...(criteria.excludeProviders || []), failedProvider];
    
    logger.warn(`🔄 Getting fallback for failed provider: ${failedProvider}`);

    // Mark failed provider as unhealthy temporarily
    this.healthStatus.set(failedProvider, false);

    try {
      const fallback = await this.getProvider({
        ...criteria,
        excludeProviders
      });

      logger.info(`🔄 Fallback provider selected: ${fallback.name}`);
      return fallback;

    } catch (error) {
      logger.error('❌ No fallback provider available:', error);
      throw new Error('All payment providers are currently unavailable');
    }
  }

  /**
   * Execute payment with automatic fallback
   */
  async executeWithFallback(operation, criteria = {}, maxRetries = 3) {
    let lastError = null;
    const excludeProviders = [];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { provider, name } = await this.getProvider({
          ...criteria,
          excludeProviders
        });

        logger.debug(`💳 Attempt ${attempt}: Using provider ${name}`);

        const result = await operation(provider, name);
        
        logger.info(`✅ Payment successful with provider: ${name}`);
        return { ...result, provider: name, attempt };

      } catch (error) {
        lastError = error;
        logger.warn(`❌ Attempt ${attempt} failed:`, error.message);

        // Add failed provider to exclusion list
        if (error.provider) {
          excludeProviders.push(error.provider);
        }

        // If this was the last attempt, throw the error
        if (attempt === maxRetries) {
          break;
        }

        // Wait before retry (exponential backoff)
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }

    logger.error(`❌ All payment attempts failed after ${maxRetries} retries`);
    throw lastError || new Error('Payment processing failed');
  }

  // ================================
  // UTILITY METHODS
  // ================================

  /**
   * Get provider statistics
   */
  getProviderStats() {
    const stats = {
      total_providers: this.providers.size,
      healthy_providers: Array.from(this.healthStatus.values()).filter(h => h).length,
      providers: {}
    };

    for (const [name, provider] of this.providers.entries()) {
      stats.providers[name] = {
        healthy: this.healthStatus.get(name),
        last_health_check: this.lastHealthCheck.get(name),
        config: PROVIDER_CONFIGS[name]
      };
    }

    return stats;
  }

  /**
   * Get fee comparison for amount
   */
  getFeeComparison(amount, paymentMethod = PAYMENT_METHODS.CARD) {
    const comparison = {};

    for (const [name] of this.providers.entries()) {
      try {
        const fees = calculatePaymentFees(amount * 100, name, paymentMethod);
        comparison[name] = {
          gross_amount: fees.grossAmount,
          total_fee: fees.totalFee,
          net_amount: fees.netAmount,
          fee_percentage: fees.feePercentage,
          provider_healthy: this.healthStatus.get(name)
        };
      } catch (error) {
        comparison[name] = {
          error: error.message,
          provider_healthy: this.healthStatus.get(name)
        };
      }
    }

    return comparison;
  }

  /**
   * Delay helper for retries
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get provider by name
   */
  getProviderByName(name) {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Provider ${name} not found`);
    }
    return provider;
  }

  /**
   * Check if factory is initialized
   */
  isReady() {
    return this.isInitialized && this.providers.size > 0;
  }

  /**
   * Get available payment methods for amount
   */
  getAvailablePaymentMethods(amount = 0) {
    const methods = new Set();
    
    for (const [name] of this.providers.entries()) {
      if (this.isProviderHealthy(name)) {
        const config = PROVIDER_CONFIGS[name];
        config.supportedMethods.forEach(method => {
          // Check amount limits
          const amountInNaira = amount / 100;
          if (amountInNaira >= config.limits.min && amountInNaira <= config.limits.max) {
            methods.add(method);
          }
        });
      }
    }

    return Array.from(methods);
  }

  /**
   * Estimate processing time for payment method
   */
  estimateProcessingTime(paymentMethod) {
    const processingTimes = {
      [PAYMENT_METHODS.CARD]: '2-5 minutes',
      [PAYMENT_METHODS.BANK_TRANSFER]: '10-30 minutes',
      [PAYMENT_METHODS.USSD]: '5-15 minutes',
      [PAYMENT_METHODS.MOBILE_MONEY]: '2-10 minutes',
      [PAYMENT_METHODS.WALLET]: '1-3 minutes',
      [PAYMENT_METHODS.QR_CODE]: '1-5 minutes'
    };

    return processingTimes[paymentMethod] || '5-15 minutes';
  }

  // ================================
  // PAYMENT PROCESSING HELPERS
  // ================================

  /**
   * Create payment with best provider
   */
  async createPayment(paymentData) {
    const operation = async (provider, providerName) => {
      switch (paymentData.payment_method) {
        case PAYMENT_METHODS.CARD:
          return await provider.createCardPayment(paymentData);
        
        case PAYMENT_METHODS.BANK_TRANSFER:
          return await provider.createBankTransfer(paymentData);
        
        case PAYMENT_METHODS.USSD:
          return await provider.createUSSDPayment(paymentData);
        
        case PAYMENT_METHODS.MOBILE_MONEY:
          return await provider.createMobileMoneyPayment(paymentData);
        
        case PAYMENT_METHODS.WALLET:
          if (providerName === PAYMENT_PROVIDERS.OPAY) {
            return await provider.createWalletPayment(paymentData);
          }
          throw new Error(`Wallet payments not supported by ${providerName}`);
        
        case PAYMENT_METHODS.QR_CODE:
          if (providerName === PAYMENT_PROVIDERS.OPAY) {
            return await provider.generateQRPayment(paymentData);
          }
          throw new Error(`QR payments not supported by ${providerName}`);
        
        default:
          throw new Error(`Unsupported payment method: ${paymentData.payment_method}`);
      }
    };

    return await this.executeWithFallback(operation, {
      amount: paymentData.amount,
      paymentMethod: paymentData.payment_method,
      userLocation: paymentData.user_location
    });
  }

  /**
   * Verify payment with correct provider
   */
  async verifyPayment(reference, providerName = null) {
    if (providerName) {
      // Use specific provider
      const provider = this.getProviderByName(providerName);
      return await provider.verifyPayment(reference);
    }

    // Try all providers until one succeeds
    let lastError = null;
    
    for (const [name, provider] of this.providers.entries()) {
      if (this.isProviderHealthy(name)) {
        try {
          const result = await provider.verifyPayment(reference);
          return { ...result, provider: name };
        } catch (error) {
          lastError = error;
          continue;
        }
      }
    }

    throw lastError || new Error('Payment verification failed across all providers');
  }

  /**
   * Process vendor payout with best provider
   */
  async processVendorPayout(payoutData) {
    const operation = async (provider, providerName) => {
      if (typeof provider.transferToVendor === 'function') {
        return await provider.transferToVendor(payoutData);
      } else if (typeof provider.createBankTransfer === 'function') {
        return await provider.createBankTransfer(payoutData);
      } else {
        throw new Error(`Provider ${providerName} does not support vendor payouts`);
      }
    };

    return await this.executeWithFallback(operation, {
      amount: payoutData.amount,
      paymentMethod: PAYMENT_METHODS.BANK_TRANSFER
    });
  }
}

// ================================
// SINGLETON EXPORT
// ================================

let factoryInstance = null;

module.exports = {
  PaymentProviderFactory,
  
  // Singleton factory
  getInstance: () => {
    if (!factoryInstance) {
      factoryInstance = new PaymentProviderFactory();
    }
    return factoryInstance;
  },

  // Initialize and return instance
  initialize: async () => {
    if (!factoryInstance) {
      factoryInstance = new PaymentProviderFactory();
    }
    await factoryInstance.initialize();
    return factoryInstance;
  },

  // Quick access to initialized instance
  getFactory: () => {
    if (!factoryInstance || !factoryInstance.isReady()) {
      throw new Error('Payment Provider Factory not initialized. Call initialize() first.');
    }
    return factoryInstance;
  }
};