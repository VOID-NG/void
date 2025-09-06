// ================================
// src/utils/paymentUtils.js
// Nigerian payment calculations and utilities
// ================================

const logger = require('./logger');
const { formatNairaAmount, toKobo, fromKobo, calculatePaymentFees } = require('../config/paymentConfig');

/**
 * Calculate marketplace commission and vendor payout
 * @param {number} amount - Transaction amount in kobo
 * @param {Object} options - Calculation options
 * @returns {Object} Breakdown of fees and payouts
 */
function calculateMarketplaceFees(amount, options = {}) {
  const {
    marketplaceCommission = 2.5, // 2.5% default commission
    paymentProvider = 'paystack',
    paymentMethod = 'card',
    promoDiscount = 0,
    vendorTier = 'basic' // basic, premium, enterprise
  } = options;

  const amountInNaira = fromKobo(amount);
  
  // Calculate payment provider fees
  const paymentFees = calculatePaymentFees(amount, paymentProvider, paymentMethod);
  
  // Calculate marketplace commission (reduced based on vendor tier)
  const tierMultiplier = {
    basic: 1.0,
    premium: 0.8,    // 20% reduction
    enterprise: 0.6  // 40% reduction
  };
  
  const adjustedCommission = marketplaceCommission * tierMultiplier[vendorTier];
  const commissionAmount = (amountInNaira * adjustedCommission) / 100;
  
  // Apply promotional discount
  const discountAmount = (amountInNaira * promoDiscount) / 100;
  const discountedAmount = amountInNaira - discountAmount;
  
  // Calculate VAT (7.5% on marketplace commission in Nigeria)
  const vatOnCommission = commissionAmount * 0.075;
  
  // Calculate final amounts
  const totalDeductions = paymentFees.totalFee + commissionAmount + vatOnCommission;
  const vendorPayout = discountedAmount - totalDeductions;
  
  return {
    grossAmount: amountInNaira,
    discountAmount: discountAmount,
    netAmount: discountedAmount,
    
    // Fee breakdown
    paymentProviderFee: paymentFees.totalFee,
    marketplaceCommission: commissionAmount,
    vatOnCommission: vatOnCommission,
    totalMarketplaceFees: commissionAmount + vatOnCommission,
    totalDeductions: totalDeductions,
    
    // Vendor details
    vendorPayout: vendorPayout,
    vendorTier: vendorTier,
    commissionRate: adjustedCommission,
    
    // Formatting for display
    formatted: {
      grossAmount: formatNairaAmount(toKobo(amountInNaira)),
      vendorPayout: formatNairaAmount(toKobo(vendorPayout)),
      totalFees: formatNairaAmount(toKobo(totalDeductions)),
      commission: formatNairaAmount(toKobo(commissionAmount))
    },
    
    currency: 'NGN'
  };
}

/**
 * Calculate installment payment schedule
 * @param {number} totalAmount - Total amount in kobo
 * @param {number} installments - Number of installments
 * @param {number} interestRate - Annual interest rate percentage
 * @returns {Object} Payment schedule
 */
function calculateInstallmentSchedule(totalAmount, installments = 3, interestRate = 0) {
  const amountInNaira = fromKobo(totalAmount);
  const monthlyRate = interestRate / 12 / 100;
  
  let monthlyPayment;
  if (interestRate === 0) {
    monthlyPayment = amountInNaira / installments;
  } else {
    // Calculate EMI using compound interest formula
    monthlyPayment = (amountInNaira * monthlyRate * Math.pow(1 + monthlyRate, installments)) /
                    (Math.pow(1 + monthlyRate, installments) - 1);
  }
  
  const schedule = [];
  let remainingBalance = amountInNaira;
  
  for (let i = 1; i <= installments; i++) {
    const interestComponent = remainingBalance * monthlyRate;
    const principalComponent = monthlyPayment - interestComponent;
    remainingBalance -= principalComponent;
    
    // Adjust last payment for rounding differences
    if (i === installments) {
      monthlyPayment += remainingBalance;
      remainingBalance = 0;
    }
    
    schedule.push({
      installmentNumber: i,
      dueDate: new Date(Date.now() + (i * 30 * 24 * 60 * 60 * 1000)), // 30 days apart
      amount: Math.round(monthlyPayment * 100) / 100,
      principalAmount: Math.round(principalComponent * 100) / 100,
      interestAmount: Math.round(interestComponent * 100) / 100,
      remainingBalance: Math.round(remainingBalance * 100) / 100,
      formatted: formatNairaAmount(toKobo(monthlyPayment))
    });
  }
  
  return {
    totalAmount: amountInNaira,
    installments: installments,
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
    totalInterest: (monthlyPayment * installments) - amountInNaira,
    effectiveRate: interestRate,
    schedule: schedule,
    formatted: {
      totalAmount: formatNairaAmount(totalAmount),
      monthlyPayment: formatNairaAmount(toKobo(monthlyPayment)),
      totalInterest: formatNairaAmount(toKobo((monthlyPayment * installments) - amountInNaira))
    }
  };
}

/**
 * Validate Nigerian bank account details
 * @param {string} accountNumber - Account number
 * @param {string} bankCode - Bank code
 * @returns {Object} Validation result
 */
function validateNigerianBankAccount(accountNumber, bankCode) {
  // Nigerian account numbers are typically 10 digits
  if (!/^\d{10}$/.test(accountNumber)) {
    return {
      valid: false,
      error: 'Nigerian bank account numbers must be exactly 10 digits'
    };
  }
  
  // Validate bank code (3 digits for Nigerian banks)
  if (!/^\d{3}$/.test(bankCode)) {
    return {
      valid: false,
      error: 'Invalid bank code format'
    };
  }
  
  return {
    valid: true,
    accountNumber: accountNumber,
    bankCode: bankCode
  };
}

// ================================
// src/utils/fileUtils.js
// File validation and optimization utilities
// ================================

const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

/**
 * Validate uploaded file
 * @param {Object} file - Multer file object
 * @param {string} fileType - Expected file type (image, video, model)
 * @returns {Object} Validation result
 */
function validateFile(file, fileType) {
  const validations = {
    image: {
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      maxSize: 10 * 1024 * 1024, // 10MB
      extensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif']
    },
    video: {
      mimeTypes: ['video/mp4', 'video/webm', 'video/mov', 'video/avi'],
      maxSize: 100 * 1024 * 1024, // 100MB
      extensions: ['.mp4', '.webm', '.mov', '.avi']
    },
    model: {
      mimeTypes: ['model/gltf-binary', 'application/octet-stream'],
      maxSize: 50 * 1024 * 1024, // 50MB
      extensions: ['.glb', '.gltf', '.obj', '.fbx']
    },
    document: {
      mimeTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      maxSize: 25 * 1024 * 1024, // 25MB
      extensions: ['.pdf', '.doc', '.docx']
    }
  };

  const config = validations[fileType];
  if (!config) {
    return { valid: false, error: 'Unknown file type' };
  }

  // Check file size
  if (file.size > config.maxSize) {
    return {
      valid: false,
      error: `File too large. Maximum size: ${config.maxSize / (1024 * 1024)}MB`
    };
  }

  // Check MIME type
  if (!config.mimeTypes.includes(file.mimetype)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: ${config.mimeTypes.join(', ')}`
    };
  }

  // Check file extension
  const ext = path.extname(file.originalname).toLowerCase();
  if (!config.extensions.includes(ext)) {
    return {
      valid: false,
      error: `Invalid file extension. Allowed extensions: ${config.extensions.join(', ')}`
    };
  }

  return {
    valid: true,
    fileType: fileType,
    size: file.size,
    mimeType: file.mimetype,
    extension: ext
  };
}

/**
 * Generate secure filename
 * @param {string} originalName - Original filename
 * @param {string} userId - User ID
 * @returns {string} Secure filename
 */
function generateSecureFilename(originalName, userId = 'anonymous') {
  const ext = path.extname(originalName).toLowerCase();
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const userHash = crypto.createHash('md5').update(userId).digest('hex').substring(0, 8);
  
  return `${userHash}_${timestamp}_${random}${ext}`;
}

/**
 * Optimize image for Nigerian internet speeds
 * @param {Buffer} imageBuffer - Image buffer
 * @param {Object} options - Optimization options
 * @returns {Object} Optimized images
 */
async function optimizeImage(imageBuffer, options = {}) {
  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 80,
    generateThumbnail = true,
    generateWebP = true
  } = options;

  try {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    
    // Main optimized image
    const optimized = await image
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality, progressive: true })
      .toBuffer();

    const result = {
      original: {
        buffer: imageBuffer,
        size: imageBuffer.length,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format
      },
      optimized: {
        buffer: optimized,
        size: optimized.length,
        format: 'jpeg',
        quality: quality
      }
    };

    // Generate thumbnail
    if (generateThumbnail) {
      const thumbnail = await image
        .resize(300, 300, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 70 })
        .toBuffer();

      result.thumbnail = {
        buffer: thumbnail,
        size: thumbnail.length,
        width: 300,
        height: 300,
        format: 'jpeg'
      };
    }

    // Generate WebP version for modern browsers
    if (generateWebP) {
      const webp = await sharp(imageBuffer)
        .resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: quality - 10 })
        .toBuffer();

      result.webp = {
        buffer: webp,
        size: webp.length,
        format: 'webp'
      };
    }

    // Calculate compression ratio
    result.compressionRatio = ((imageBuffer.length - optimized.length) / imageBuffer.length * 100).toFixed(2);

    return result;

  } catch (error) {
    logger.error('Image optimization failed:', error);
    throw new Error(`Image optimization failed: ${error.message}`);
  }
}

// ================================
// src/utils/hashUtils.js
// Secure hashing utilities
// ================================

const bcrypt = require('bcryptjs');

/**
 * Hash password with bcrypt
 * @param {string} password - Plain text password
 * @returns {string} Hashed password
 */
async function hashPassword(password) {
  try {
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const salt = await bcrypt.genSalt(saltRounds);
    return await bcrypt.hash(password, salt);
  } catch (error) {
    logger.error('Password hashing failed:', error);
    throw new Error('Password hashing failed');
  }
}

/**
 * Compare password with hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {boolean} Comparison result
 */
async function comparePassword(password, hash) {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    logger.error('Password comparison failed:', error);
    return false;
  }
}

/**
 * Generate secure random string
 * @param {number} length - String length
 * @returns {string} Random string
 */
function generateSecureRandom(length = 32) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/**
 * Generate HMAC signature for webhook verification
 * @param {string} payload - Payload to sign
 * @param {string} secret - Secret key
 * @param {string} algorithm - Hash algorithm
 * @returns {string} HMAC signature
 */
function generateHMAC(payload, secret, algorithm = 'sha256') {
  return crypto.createHmac(algorithm, secret).update(payload).digest('hex');
}

/**
 * Verify HMAC signature
 * @param {string} payload - Original payload
 * @param {string} signature - Signature to verify
 * @param {string} secret - Secret key
 * @param {string} algorithm - Hash algorithm
 * @returns {boolean} Verification result
 */
function verifyHMAC(payload, signature, secret, algorithm = 'sha256') {
  const expectedSignature = generateHMAC(payload, secret, algorithm);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

// ================================
// src/utils/notificationUtils.js
// Notification templates and utilities
// ================================

/**
 * Email templates for Nigerian users
 */
const EMAIL_TEMPLATES = {
  WELCOME: {
    subject: 'Welcome to Void Marketplace! 🇳🇬',
    template: `
      <h2>Welcome to Void Marketplace!</h2>
      <p>Hello {{firstName}},</p>
      <p>Welcome to Nigeria's premier online marketplace. We're excited to have you join our community of buyers and sellers.</p>
      <p><strong>What you can do on Void Marketplace:</strong></p>
      <ul>
        <li>Buy and sell products with fellow Nigerians</li>
        <li>Pay with your preferred Nigerian payment method</li>
        <li>Enjoy secure escrow protection</li>
        <li>Chat with sellers to negotiate prices</li>
      </ul>
      <p>Get started by exploring our marketplace or listing your first product!</p>
      <p>Happy trading!<br>The Void Marketplace Team</p>
    `
  },

  PAYMENT_SUCCESS: {
    subject: 'Payment Successful - Order #{{orderNumber}}',
    template: `
      <h2>Payment Confirmed! ✅</h2>
      <p>Hello {{firstName}},</p>
      <p>Your payment of <strong>{{amount}}</strong> for order #{{orderNumber}} has been successfully processed.</p>
      <p><strong>Order Details:</strong></p>
      <ul>
        <li>Product: {{productName}}</li>
        <li>Amount: {{amount}}</li>
        <li>Payment Method: {{paymentMethod}}</li>
        <li>Transaction ID: {{transactionId}}</li>
      </ul>
      <p>Your order is now being processed by the seller. You'll receive updates as your order progresses.</p>
    `
  },

  NEW_ORDER: {
    subject: 'New Order Received - #{{orderNumber}}',
    template: `
      <h2>You have a new order! 🎉</h2>
      <p>Hello {{sellerName}},</p>
      <p>Great news! You've received a new order on Void Marketplace.</p>
      <p><strong>Order Details:</strong></p>
      <ul>
        <li>Order Number: #{{orderNumber}}</li>
        <li>Product: {{productName}}</li>
        <li>Quantity: {{quantity}}</li>
        <li>Amount: {{amount}}</li>
        <li>Buyer: {{buyerName}}</li>
        <li>Delivery Address: {{deliveryAddress}}</li>
      </ul>
      <p>The payment is being held in escrow and will be released to you once the buyer confirms delivery.</p>
      <p>Please process this order promptly to maintain your seller rating.</p>
    `
  },

  ESCROW_RELEASED: {
    subject: 'Payment Released - {{amount}} credited to your account',
    template: `
      <h2>Payment Released! 💰</h2>
      <p>Hello {{sellerName}},</p>
      <p>The escrow payment for order #{{orderNumber}} has been released and credited to your account.</p>
      <p><strong>Payment Details:</strong></p>
      <ul>
        <li>Amount: {{amount}}</li>
        <li>Order: #{{orderNumber}}</li>
        <li>Product: {{productName}}</li>
        <li>Released On: {{releaseDate}}</li>
      </ul>
      <p>The funds will be transferred to your bank account within 1-2 business days.</p>
    `
  },

  DISPUTE_OPENED: {
    subject: 'Dispute Opened - Order #{{orderNumber}}',
    template: `
      <h2>Dispute Notification ⚠️</h2>
      <p>Hello {{userName}},</p>
      <p>A dispute has been opened for order #{{orderNumber}}.</p>
      <p><strong>Dispute Details:</strong></p>
      <ul>
        <li>Order: #{{orderNumber}}</li>
        <li>Reason: {{disputeReason}}</li>
        <li>Opened By: {{disputeOpenedBy}}</li>
        <li>Description: {{disputeDescription}}</li>
      </ul>
      <p>Our support team will review this dispute and work towards a fair resolution.</p>
      <p>You can provide additional information by responding to this dispute in your dashboard.</p>
    `
  }
};

/**
 * SMS templates for Nigerian networks
 */
const SMS_TEMPLATES = {
  OTP_VERIFICATION: 'Your Void Marketplace verification code is: {{code}}. Valid for 10 minutes. Do not share this code.',
  
  PAYMENT_SUCCESS: 'Payment successful! ₦{{amount}} paid for order #{{orderNumber}}. Thank you for using Void Marketplace.',
  
  ORDER_SHIPPED: 'Your order #{{orderNumber}} has been shipped! Track: {{trackingNumber}}. Expected delivery: {{deliveryDate}}.',
  
  LOW_BALANCE: 'Your Void Marketplace wallet balance is low: ₦{{balance}}. Top up to continue transactions.'
};

/**
 * Push notification templates
 */
const PUSH_TEMPLATES = {
  NEW_MESSAGE: {
    title: 'New Message',
    body: '{{senderName}}: {{messagePreview}}',
    icon: '/icons/message.png',
    badge: '/icons/badge.png'
  },

  OFFER_RECEIVED: {
    title: 'New Offer Received',
    body: '{{buyerName}} offered ₦{{amount}} for {{productName}}',
    icon: '/icons/offer.png'
  },

  PAYMENT_RECEIVED: {
    title: 'Payment Received',
    body: 'You received ₦{{amount}} for {{productName}}',
    icon: '/icons/payment.png'
  }
};

/**
 * Compile notification template with data
 * @param {string} template - Template string
 * @param {Object} data - Data to interpolate
 * @returns {string} Compiled template
 */
function compileTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] || match;
  });
}

/**
 * Format notification for Nigerian context
 * @param {string} type - Notification type
 * @param {Object} data - Notification data
 * @param {string} language - Language preference
 * @returns {Object} Formatted notification
 */
function formatNotification(type, data, language = 'en') {
  const templates = {
    email: EMAIL_TEMPLATES[type],
    sms: SMS_TEMPLATES[type],
    push: PUSH_TEMPLATES[type]
  };

  if (!templates.email) {
    throw new Error(`Unknown notification type: ${type}`);
  }

  // Add Nigerian-specific formatting
  if (data.amount) {
    data.amount = formatNairaAmount(toKobo(data.amount));
  }

  if (data.date) {
    // Format date for Nigerian timezone (WAT)
    data.date = new Date(data.date).toLocaleString('en-NG', {
      timeZone: 'Africa/Lagos',
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  return {
    email: {
      subject: compileTemplate(templates.email.subject, data),
      html: compileTemplate(templates.email.template, data),
      text: compileTemplate(templates.email.template, data).replace(/<[^>]*>/g, '')
    },
    sms: templates.sms ? compileTemplate(templates.sms, data) : null,
    push: templates.push ? {
      title: compileTemplate(templates.push.title, data),
      body: compileTemplate(templates.push.body, data),
      icon: templates.push.icon,
      badge: templates.push.badge
    } : null
  };
}

/**
 * Validate Nigerian phone number for SMS
 * @param {string} phoneNumber - Phone number
 * @returns {Object} Validation result
 */
function validateNigerianPhoneForSMS(phoneNumber) {
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
    normalized: normalized,
    international: '+234' + normalized.substring(1)
  };
}

// ================================
// src/utils/fuzzySearchUtils.js
// Nigerian-optimized fuzzy search
// ================================

const Fuse = require('fuse.js');

/**
 * Nigerian product name variations and slang
 */
const NIGERIAN_PRODUCT_ALIASES = {
  'phone': ['fone', 'mobile', 'cell', 'handset'],
  'laptop': ['system', 'computer', 'pc'],
  'generator': ['gen', 'power', 'plant'],
  'television': ['tv', 'plasma', 'led'],
  'refrigerator': ['fridge', 'freezer'],
  'air conditioner': ['ac', 'airconditioner', 'cooling'],
  'clothing': ['cloth', 'wear', 'dress'],
  'shoes': ['footwear', 'sandals', 'slippers'],
  'rice': ['foreign rice', 'local rice', 'basmati'],
  'car': ['motor', 'vehicle', 'auto'],
  'house': ['property', 'building', 'apartment'],
  'land': ['plot', 'acre', 'property']
};

/**
 * Nigerian location aliases
 */
const NIGERIAN_LOCATION_ALIASES = {
  'lagos': ['lasgidi', 'eko', 'gidi'],
  'abuja': ['fcT', 'federal capital territory'],
  'port harcourt': ['ph', 'garden city'],
  'kano': ['kano state'],
  'ibadan': ['ibadan oyo'],
  'kaduna': ['kaduna state'],
  'jos': ['jos plateau'],
  'warri': ['warri delta'],
  'calabar': ['calabar cross river'],
  'enugu': ['enugu state']
};

/**
 * Create fuzzy search instance with Nigerian optimizations
 * @param {Array} data - Data to search
 * @param {Object} options - Search options
 * @returns {Object} Fuse instance
 */
function createFuzzySearch(data, options = {}) {
  const defaultOptions = {
    keys: options.keys || ['name', 'title', 'description'],
    threshold: 0.4, // More lenient for Nigerian variations
    distance: 100,
    includeScore: true,
    includeMatches: true,
    minMatchCharLength: 2,
    ignoreLocation: true,
    ...options
  };

  return new Fuse(data, defaultOptions);
}

/**
 * Expand search query with Nigerian aliases
 * @param {string} query - Search query
 * @returns {Array} Expanded queries
 */
function expandSearchQuery(query) {
  const normalizedQuery = query.toLowerCase().trim();
  const expandedQueries = [normalizedQuery];

  // Check for product aliases
  for (const [standard, aliases] of Object.entries(NIGERIAN_PRODUCT_ALIASES)) {
    if (aliases.includes(normalizedQuery) || normalizedQuery.includes(standard)) {
      expandedQueries.push(standard);
      expandedQueries.push(...aliases);
    }
  }

  // Check for location aliases
  for (const [standard, aliases] of Object.entries(NIGERIAN_LOCATION_ALIASES)) {
    if (aliases.includes(normalizedQuery) || normalizedQuery.includes(standard)) {
      expandedQueries.push(standard);
      expandedQueries.push(...aliases);
    }
  }

  // Remove duplicates
  return [...new Set(expandedQueries)];
}

/**
 * Perform Nigerian-optimized fuzzy search
 * @param {Object} fuseInstance - Fuse search instance
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Array} Search results
 */
function performFuzzySearch(fuseInstance, query, options = {}) {
  const {
    limit = 50,
    includeAliases = true,
    boostExactMatches = true
  } = options;

  let queries = [query];
  
  if (includeAliases) {
    queries = expandSearchQuery(query);
  }

  const allResults = [];

  // Search with all query variations
  for (const searchQuery of queries) {
    const results = fuseInstance.search(searchQuery);
    allResults.push(...results);
  }

  // Remove duplicates based on item id or reference
  const uniqueResults = allResults.filter((result, index, self) => {
    return index === self.findIndex(r => 
      (r.item.id && r.item.id === result.item.id) ||
      (r.item._id && r.item._id === result.item._id) ||
      JSON.stringify(r.item) === JSON.stringify(result.item)
    );
  });

  // Sort by relevance score
  const sortedResults = uniqueResults.sort((a, b) => {
    if (boostExactMatches) {
      // Boost exact matches
      const aExact = a.item.name?.toLowerCase().includes(query.toLowerCase()) ||
                    a.item.title?.toLowerCase().includes(query.toLowerCase());
      const bExact = b.item.name?.toLowerCase().includes(query.toLowerCase()) ||
                    b.item.title?.toLowerCase().includes(query.toLowerCase());
      
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
    }
    
    return a.score - b.score;
  });

  return sortedResults.slice(0, limit);
}

/**
 * Generate search suggestions for autocomplete
 * @param {Array} searchHistory - User search history
 * @param {Array} popularTerms - Popular search terms
 * @param {string} currentInput - Current user input
 * @returns {Array} Search suggestions
 */
function generateSearchSuggestions(searchHistory = [], popularTerms = [], currentInput = '') {
  const suggestions = [];
  const input = currentInput.toLowerCase();

  // Add matching items from search history
  const historyMatches = searchHistory
    .filter(term => term.toLowerCase().includes(input))
    .slice(0, 3);
  suggestions.push(...historyMatches.map(term => ({ text: term, type: 'history' })));

  // Add matching popular terms
  const popularMatches = popularTerms
    .filter(term => term.toLowerCase().includes(input))
    .slice(0, 5);
  suggestions.push(...popularMatches.map(term => ({ text: term, type: 'popular' })));

  // Add Nigerian-specific suggestions
  const nigerianSuggestions = [];
  for (const [standard, aliases] of Object.entries(NIGERIAN_PRODUCT_ALIASES)) {
    if (standard.includes(input) || aliases.some(alias => alias.includes(input))) {
      nigerianSuggestions.push({ text: standard, type: 'suggestion' });
    }
  }
  suggestions.push(...nigerianSuggestions.slice(0, 3));

  // Remove duplicates and limit results
  const uniqueSuggestions = suggestions.filter((suggestion, index, self) =>
    index === self.findIndex(s => s.text === suggestion.text)
  );

  return uniqueSuggestions.slice(0, 8);
}

// ================================
// EXPORTS
// ================================

module.exports = {
  // Payment utilities
  calculateMarketplaceFees,
  calculateInstallmentSchedule,
  validateNigerianBankAccount,

  // File utilities
  validateFile,
  generateSecureFilename,
  optimizeImage,

  // Hash utilities
  hashPassword,
  comparePassword,
  generateSecureRandom,
  generateHMAC,
  verifyHMAC,

  // Notification utilities
  EMAIL_TEMPLATES,
  SMS_TEMPLATES,
  PUSH_TEMPLATES,
  compileTemplate,
  formatNotification,
  validateNigerianPhoneForSMS,

  // Fuzzy search utilities
  NIGERIAN_PRODUCT_ALIASES,
  NIGERIAN_LOCATION_ALIASES,
  createFuzzySearch,
  expandSearchQuery,
  performFuzzySearch,
  generateSearchSuggestions
};