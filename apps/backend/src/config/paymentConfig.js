// src/config/paymentConfig.js
// Nigerian Payment Providers Configuration
// Supports Paystack, Flutterwave, Opay, VoguePay, Payant, and mobile money

const logger = require('../utils/logger');

// ================================
// PAYMENT PROVIDER CONFIGURATIONS
// ================================

const PAYMENT_PROVIDERS = {
  PAYSTACK: 'paystack',
  FLUTTERWAVE: 'flutterwave', 
  OPAY: 'opay',
  VOGUEPAY: 'voguepay',
  PAYANT: 'payant',
  BANK_TRANSFER: 'bank_transfer',
  MOBILE_MONEY: 'mobile_money',
  USSD: 'ussd'
};

// ================================
// NIGERIAN PAYMENT METHODS
// ================================

const PAYMENT_METHODS = {
  CARD: 'card',
  BANK_TRANSFER: 'bank_transfer',
  USSD: 'ussd',
  QR_CODE: 'qr_code',
  MOBILE_MONEY: 'mobile_money',
  AIRTEL_MONEY: 'airtel_money',
  MTN_MOBILE_MONEY: 'mtn_mobile_money',
  GLO_MOBILE_MONEY: 'glo_mobile_money',
  NINE_MOBILE_MONEY: '9mobile_money',
  WALLET: 'wallet',
  POS: 'pos'
};

// ================================
// PAYMENT PROVIDER CONFIGURATIONS
// ================================

const PROVIDER_CONFIGS = {
  [PAYMENT_PROVIDERS.PAYSTACK]: {
    name: 'Paystack',
    baseUrl: 'https://api.paystack.co',
    testBaseUrl: 'https://api.paystack.co',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY,
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET,
    supportedMethods: [
      PAYMENT_METHODS.CARD,
      PAYMENT_METHODS.BANK_TRANSFER,
      PAYMENT_METHODS.USSD,
      PAYMENT_METHODS.QR_CODE,
      PAYMENT_METHODS.MOBILE_MONEY
    ],
    currency: 'NGN',
    fees: {
      percentage: 1.5, // 1.5%
      cap: 200000, // ₦2,000 cap
      flatFee: 0 // No flat fee
    },
    limits: {
      min: 100, // ₦1
      max: 50000000 // ₦500,000
    },
    settlement: {
      t1: true, // Next business day
      instant: false
    },
    features: {
      splits: true,
      subscriptions: true,
      invoices: true,
      transfers: true,
      virtualAccounts: true
    }
  },

  [PAYMENT_PROVIDERS.FLUTTERWAVE]: {
    name: 'Flutterwave',
    baseUrl: 'https://api.flutterwave.com/v3',
    testBaseUrl: 'https://api.flutterwave.com/v3',
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY,
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY,
    encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY,
    webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET,
    supportedMethods: [
      PAYMENT_METHODS.CARD,
      PAYMENT_METHODS.BANK_TRANSFER,
      PAYMENT_METHODS.USSD,
      PAYMENT_METHODS.MOBILE_MONEY,
      PAYMENT_METHODS.QR_CODE
    ],
    currency: 'NGN',
    fees: {
      percentage: 1.4, // 1.4%
      cap: 200000, // ₦2,000 cap
      flatFee: 0
    },
    limits: {
      min: 100,
      max: 50000000
    },
    settlement: {
      t1: true,
      instant: true // Available for verified businesses
    },
    features: {
      splits: true,
      subscriptions: true,
      invoices: true,
      transfers: true,
      virtualAccounts: true,
      bvnVerification: true
    }
  },

  [PAYMENT_PROVIDERS.OPAY]: {
    name: 'Opay',
    baseUrl: 'https://sandboxapi.opayweb.com',
    liveBaseUrl: 'https://api.opayweb.com',
    merchantId: process.env.OPAY_MERCHANT_ID,
    secretKey: process.env.OPAY_SECRET_KEY,
    publicKey: process.env.OPAY_PUBLIC_KEY,
    supportedMethods: [
      PAYMENT_METHODS.CARD,
      PAYMENT_METHODS.BANK_TRANSFER,
      PAYMENT_METHODS.WALLET,
      PAYMENT_METHODS.USSD,
      PAYMENT_METHODS.QR_CODE
    ],
    currency: 'NGN',
    fees: {
      percentage: 1.5,
      cap: 200000,
      flatFee: 0
    },
    limits: {
      min: 100,
      max: 50000000
    },
    settlement: {
      t1: true,
      instant: false
    },
    features: {
      splits: false,
      subscriptions: true,
      invoices: false,
      transfers: true,
      virtualAccounts: false
    }
  },

  [PAYMENT_PROVIDERS.VOGUEPAY]: {
    name: 'VoguePay',
    baseUrl: 'https://voguepay.com/api/v1',
    merchantId: process.env.VOGUEPAY_MERCHANT_ID,
    webhookUrl: process.env.VOGUEPAY_WEBHOOK_URL,
    supportedMethods: [
      PAYMENT_METHODS.CARD,
      PAYMENT_METHODS.BANK_TRANSFER
    ],
    currency: 'NGN',
    fees: {
      percentage: 1.5,
      cap: 200000,
      flatFee: 0
    },
    limits: {
      min: 100,
      max: 10000000
    },
    settlement: {
      t1: true,
      instant: false
    },
    features: {
      splits: false,
      subscriptions: false,
      invoices: false,
      transfers: false,
      virtualAccounts: false
    }
  }
};

// ================================
// MOBILE MONEY PROVIDERS
// ================================

const MOBILE_MONEY_PROVIDERS = {
  AIRTEL: {
    name: 'Airtel Money',
    code: 'airtel',
    prefix: ['0701', '0708', '0802', '0808', '0812', '0901', '0902', '0907'],
    shortCode: '*432#',
    limits: {
      min: 100,
      max: 500000 // ₦5,000 daily limit
    }
  },
  MTN: {
    name: 'MTN Mobile Money',
    code: 'mtn',
    prefix: ['0703', '0706', '0803', '0806', '0810', '0813', '0814', '0816', '0903', '0906'],
    shortCode: '*737#',
    limits: {
      min: 100,
      max: 500000
    }
  },
  GLO: {
    name: 'Glo Mobile Money',
    code: 'glo',
    prefix: ['0705', '0805', '0807', '0811', '0815', '0905'],
    shortCode: '*777#',
    limits: {
      min: 100,
      max: 300000 // ₦3,000 daily limit
    }
  },
  NINE_MOBILE: {
    name: '9mobile Money',
    code: '9mobile',
    prefix: ['0809', '0817', '0818', '0908', '0909'],
    shortCode: '*229#',
    limits: {
      min: 100,
      max: 300000
    }
  }
};

// ================================
// NIGERIAN BANKS
// ================================

const NIGERIAN_BANKS = {
  '044': { name: 'Access Bank', code: 'access', ussd: '*901#' },
  '014': { name: 'Afribank Nigeria Plc', code: 'afribank', ussd: '*377#' },
  '023': { name: 'Citibank Nigeria Limited', code: 'citibank', ussd: '*242#' },
  '050': { name: 'Ecobank Nigeria Plc', code: 'ecobank', ussd: '*326#' },
  '070': { name: 'Fidelity Bank', code: 'fidelity', ussd: '*770#' },
  '011': { name: 'First Bank of Nigeria', code: 'firstbank', ussd: '*894#' },
  '214': { name: 'First City Monument Bank', code: 'fcmb', ussd: '*329#' },
  '058': { name: 'Guaranty Trust Bank', code: 'gtbank', ussd: '*737#' },
  '030': { name: 'Heritage Bank', code: 'heritage', ussd: '*745#' },
  '301': { name: 'Jaiz Bank', code: 'jaiz', ussd: '*389#' },
  '082': { name: 'Keystone Bank', code: 'keystone', ussd: '*533#' },
  '526': { name: 'Parallex Bank', code: 'parallex', ussd: '*322*372#' },
  '076': { name: 'Polaris Bank', code: 'polaris', ussd: '*833#' },
  '101': { name: 'Providus Bank', code: 'providus', ussd: '*737*6#' },
  '221': { name: 'Stanbic IBTC Bank', code: 'stanbic', ussd: '*909#' },
  '068': { name: 'Standard Chartered Bank', code: 'standardchartered', ussd: '*977#' },
  '232': { name: 'Sterling Bank', code: 'sterling', ussd: '*822#' },
  '100': { name: 'Suntrust Bank', code: 'suntrust', ussd: '*5230#' },
  '032': { name: 'Union Bank of Nigeria', code: 'unionbank', ussd: '*826#' },
  '033': { name: 'United Bank For Africa', code: 'uba', ussd: '*919#' },
  '215': { name: 'Unity Bank', code: 'unity', ussd: '*7799#' },
  '035': { name: 'Wema Bank', code: 'wema', ussd: '*945#' },
  '057': { name: 'Zenith Bank', code: 'zenith', ussd: '*966#' }
};

// ================================
// PAYMENT ROUTING LOGIC
// ================================

const PAYMENT_ROUTING = {
  // Primary provider selection based on amount
  PRIMARY_PROVIDER_RULES: [
    {
      condition: (amount) => amount >= 50000000, // ≥ ₦500,000
      provider: PAYMENT_PROVIDERS.FLUTTERWAVE,
      reason: 'High-value transactions'
    },
    {
      condition: (amount) => amount >= 10000000, // ≥ ₦100,000
      provider: PAYMENT_PROVIDERS.PAYSTACK,
      reason: 'Medium-value transactions'
    },
    {
      condition: (amount) => amount < 10000000, // < ₦100,000
      provider: PAYMENT_PROVIDERS.PAYSTACK,
      reason: 'Low-value transactions'
    }
  ],

  // Fallback provider order
  FALLBACK_ORDER: [
    PAYMENT_PROVIDERS.PAYSTACK,
    PAYMENT_PROVIDERS.FLUTTERWAVE,
    PAYMENT_PROVIDERS.OPAY,
    PAYMENT_PROVIDERS.VOGUEPAY
  ],

  // Method-specific routing
  METHOD_ROUTING: {
    [PAYMENT_METHODS.CARD]: [PAYMENT_PROVIDERS.PAYSTACK, PAYMENT_PROVIDERS.FLUTTERWAVE],
    [PAYMENT_METHODS.BANK_TRANSFER]: [PAYMENT_PROVIDERS.PAYSTACK, PAYMENT_PROVIDERS.FLUTTERWAVE, PAYMENT_PROVIDERS.OPAY],
    [PAYMENT_METHODS.USSD]: [PAYMENT_PROVIDERS.PAYSTACK, PAYMENT_PROVIDERS.FLUTTERWAVE],
    [PAYMENT_METHODS.MOBILE_MONEY]: [PAYMENT_PROVIDERS.PAYSTACK, PAYMENT_PROVIDERS.FLUTTERWAVE],
    [PAYMENT_METHODS.WALLET]: [PAYMENT_PROVIDERS.OPAY]
  }
};

// ================================
// FEE CALCULATION FUNCTIONS
// ================================

/**
 * Calculate payment fees for a transaction
 * @param {number} amount - Transaction amount in kobo
 * @param {string} provider - Payment provider
 * @param {string} method - Payment method
 * @returns {Object} Fee breakdown
 */
function calculatePaymentFees(amount, provider = PAYMENT_PROVIDERS.PAYSTACK, method = PAYMENT_METHODS.CARD) {
  const config = PROVIDER_CONFIGS[provider];
  
  if (!config) {
    throw new Error(`Unknown payment provider: ${provider}`);
  }

  const amountInNaira = amount / 100; // Convert from kobo to naira
  
  // Calculate percentage fee
  let percentageFee = (amountInNaira * config.fees.percentage) / 100;
  
  // Apply cap if exists
  if (config.fees.cap && percentageFee > config.fees.cap / 100) {
    percentageFee = config.fees.cap / 100;
  }
  
  // Add flat fee
  const flatFee = config.fees.flatFee / 100;
  
  const totalFee = percentageFee + flatFee;
  const netAmount = amountInNaira - totalFee;
  
  return {
    grossAmount: amountInNaira,
    percentageFee: percentageFee,
    flatFee: flatFee,
    totalFee: totalFee,
    netAmount: netAmount,
    feePercentage: config.fees.percentage,
    provider: provider,
    method: method,
    currency: 'NGN'
  };
}

/**
 * Select optimal payment provider based on amount and preferences
 * @param {number} amount - Transaction amount in kobo
 * @param {string} preferredMethod - Preferred payment method
 * @param {string[]} excludeProviders - Providers to exclude
 * @returns {string} Selected provider
 */
function selectPaymentProvider(amount, preferredMethod = PAYMENT_METHODS.CARD, excludeProviders = []) {
  try {
    const amountInNaira = amount / 100;
    
    // Check method-specific routing first
    if (PAYMENT_ROUTING.METHOD_ROUTING[preferredMethod]) {
      const methodProviders = PAYMENT_ROUTING.METHOD_ROUTING[preferredMethod]
        .filter(provider => !excludeProviders.includes(provider));
      
      if (methodProviders.length > 0) {
        return methodProviders[0];
      }
    }
    
    // Apply primary provider rules
    for (const rule of PAYMENT_ROUTING.PRIMARY_PROVIDER_RULES) {
      if (rule.condition(amountInNaira) && !excludeProviders.includes(rule.provider)) {
        logger.info(`Selected ${rule.provider} for payment: ${rule.reason}`);
        return rule.provider;
      }
    }
    
    // Fallback to first available provider
    const fallbackProvider = PAYMENT_ROUTING.FALLBACK_ORDER
      .find(provider => !excludeProviders.includes(provider));
    
    if (!fallbackProvider) {
      throw new Error('No available payment providers');
    }
    
    logger.warn(`Using fallback provider: ${fallbackProvider}`);
    return fallbackProvider;
    
  } catch (error) {
    logger.error('Error selecting payment provider:', error);
    return PAYMENT_PROVIDERS.PAYSTACK; // Default fallback
  }
}

/**
 * Validate payment method for phone number (mobile money)
 * @param {string} phoneNumber - Nigerian phone number
 * @returns {Object} Validation result with detected network
 */
function validateMobileMoneyNumber(phoneNumber) {
  // Remove country code and normalize
  const normalized = phoneNumber.replace(/^\+?234/, '0').replace(/\s+/g, '');
  
  if (!/^0[7-9][0-1]\d{8}$/.test(normalized)) {
    return {
      valid: false,
      error: 'Invalid Nigerian phone number format'
    };
  }
  
  const prefix = normalized.substring(0, 4);
  
  for (const [network, config] of Object.entries(MOBILE_MONEY_PROVIDERS)) {
    if (config.prefix.includes(prefix)) {
      return {
        valid: true,
        network: network,
        provider: config,
        normalizedNumber: normalized,
        shortCode: config.shortCode
      };
    }
  }
  
  return {
    valid: false,
    error: 'Phone number network not supported for mobile money'
  };
}

/**
 * Get bank information by bank code
 * @param {string} bankCode - Bank code
 * @returns {Object|null} Bank information
 */
function getBankInfo(bankCode) {
  return NIGERIAN_BANKS[bankCode] || null;
}

/**
 * Format amount in Nigerian Naira
 * @param {number} amount - Amount in kobo
 * @returns {string} Formatted amount
 */
function formatNairaAmount(amount) {
  const naira = amount / 100;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2
  }).format(naira);
}

/**
 * Convert amount to kobo (smallest currency unit)
 * @param {number} nairaAmount - Amount in naira
 * @returns {number} Amount in kobo
 */
function toKobo(nairaAmount) {
  return Math.round(nairaAmount * 100);
}

/**
 * Convert amount from kobo to naira
 * @param {number} koboAmount - Amount in kobo
 * @returns {number} Amount in naira
 */
function fromKobo(koboAmount) {
  return koboAmount / 100;
}

// ================================
// WEBHOOK VERIFICATION FUNCTIONS
// ================================

/**
 * Verify Paystack webhook signature
 * @param {string} payload - Webhook payload
 * @param {string} signature - Webhook signature
 * @returns {boolean} Verification result
 */
function verifyPaystackWebhook(payload, signature) {
  const crypto = require('crypto');
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET;
  
  if (!secret) {
    logger.warn('Paystack webhook secret not configured');
    return false;
  }
  
  const hash = crypto
    .createHmac('sha512', secret)
    .update(payload)
    .digest('hex');
  
  return hash === signature;
}

/**
 * Verify Flutterwave webhook signature
 * @param {string} payload - Webhook payload
 * @param {string} signature - Webhook signature
 * @returns {boolean} Verification result
 */
function verifyFlutterwaveWebhook(payload, signature) {
  const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
  
  if (!secret) {
    logger.warn('Flutterwave webhook secret not configured');
    return false;
  }
  
  // Flutterwave uses simple secret comparison
  return signature === secret;
}

// ================================
// EXPORTS
// ================================

module.exports = {
  // Constants
  PAYMENT_PROVIDERS,
  PAYMENT_METHODS,
  PROVIDER_CONFIGS,
  MOBILE_MONEY_PROVIDERS,
  NIGERIAN_BANKS,
  PAYMENT_ROUTING,
  
  // Functions
  calculatePaymentFees,
  selectPaymentProvider,
  validateMobileMoneyNumber,
  getBankInfo,
  formatNairaAmount,
  toKobo,
  fromKobo,
  verifyPaystackWebhook,
  verifyFlutterwaveWebhook
};