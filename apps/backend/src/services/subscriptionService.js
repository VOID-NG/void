// apps/backend/src/services/subscriptionService.js
// Comprehensive subscription and billing management system

const { prisma } = require('../config/db-original');
const logger = require('../utils/logger');
const { SUBSCRIPTION_PLAN, SUBSCRIPTION_STATUS, SUBSCRIPTION_FEATURES } = require('../config/constants');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const notificationService = require('./notificationService');

// ================================
// SUBSCRIPTION PLANS
// ================================

/**
 * Get all available subscription plans
 * @returns {Array} Available subscription plans
 */
const getSubscriptionPlans = () => {
  const plans = [
    {
      id: SUBSCRIPTION_PLAN.FREE,
      name: 'Free',
      description: 'Perfect for getting started',
      price: 0,
      billing_cycle: 'lifetime',
      features: SUBSCRIPTION_FEATURES[SUBSCRIPTION_PLAN.FREE],
      stripe_price_id: null
    },
    {
      id: SUBSCRIPTION_PLAN.BASIC,
      name: 'Basic',
      description: 'Great for small vendors',
      price: 29.99,
      billing_cycle: 'monthly',
      features: SUBSCRIPTION_FEATURES[SUBSCRIPTION_PLAN.BASIC],
      stripe_price_id: process.env.STRIPE_BASIC_PRICE_ID
    },
    {
      id: SUBSCRIPTION_PLAN.PREMIUM,
      name: 'Premium',
      description: 'Perfect for growing businesses',
      price: 99.99,
      billing_cycle: 'monthly',
      features: SUBSCRIPTION_FEATURES[SUBSCRIPTION_PLAN.PREMIUM],
      stripe_price_id: process.env.STRIPE_PREMIUM_PRICE_ID
    },
    {
      id: SUBSCRIPTION_PLAN.ENTERPRISE,
      name: 'Enterprise',
      description: 'For large-scale operations',
      price: 299.99,
      billing_cycle: 'monthly',
      features: SUBSCRIPTION_FEATURES[SUBSCRIPTION_PLAN.ENTERPRISE],
      stripe_price_id: process.env.STRIPE_ENTERPRISE_PRICE_ID
    }
  ];

  return plans;
};

/**
 * Get subscription plan details
 * @param {string} planId - Plan ID
 * @returns {Object} Plan details
 */
const getSubscriptionPlan = (planId) => {
  const plans = getSubscriptionPlans();
  const plan = plans.find(p => p.id === planId);
  
  if (!plan) {
    throw new Error('Subscription plan not found');
  }
  
  return plan;
};

// ================================
// CORE SUBSCRIPTION FUNCTIONS
// ================================

/**
 * Create or update user subscription
 * @param {Object} subscriptionData - Subscription details
 * @returns {Object} Created/updated subscription
 */
const createSubscription = async (subscriptionData) => {
  try {
    const {
      user_id,
      plan,
      billing_cycle = 'monthly',
      payment_method_id = null
    } = subscriptionData;

    // Validate plan
    const planDetails = getSubscriptionPlan(plan);
    
    // Check if user already has a subscription
    const existingSubscription = await prisma.subscription.findUnique({
      where: { user_id }
    });

    if (existingSubscription && existingSubscription.status === SUBSCRIPTION_STATUS.ACTIVE) {
      throw new Error('User already has an active subscription');
    }

    let stripeSubscription = null;
    let currentPeriodStart = new Date();
    let currentPeriodEnd = new Date();

    // Handle paid plans
    if (plan !== SUBSCRIPTION_PLAN.FREE && planDetails.stripe_price_id) {
      if (!payment_method_id) {
        throw new Error('Payment method required for paid plans');
      }

      // Create Stripe subscription
      stripeSubscription = await createStripeSubscription({
        user_id,
        price_id: planDetails.stripe_price_id,
        payment_method_id
      });

      currentPeriodStart = new Date(stripeSubscription.current_period_start * 1000);
      currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
    } else {
      // Free plan - set indefinite period
      currentPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year from now
    }

    // Create or update subscription record
    const subscription = await prisma.subscription.upsert({
      where: { user_id },
      update: {
        plan,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        price: planDetails.price,
        billing_cycle,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        stripe_subscription_id: stripeSubscription?.id || null,
        cancelled_at: null
      },
      create: {
        user_id,
        plan,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        price: planDetails.price,
        billing_cycle,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        stripe_subscription_id: stripeSubscription?.id || null
      },
      include: {
        user: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true
          }
        }
      }
    });

    logger.info('Subscription created/updated successfully', {
      subscriptionId: subscription.id,
      userId: user_id,
      plan,
      price: planDetails.price
    });

    // Send welcome notification
    await notificationService.createNotification({
      user_id,
      type: 'SUBSCRIPTION_ACTIVATED',
      title: 'Subscription Activated',
      message: `Your ${planDetails.name} subscription has been activated!`,
      metadata: {
        subscription_id: subscription.id,
        plan,
        price: planDetails.price
      },
      send_email: true
    });

    return subscription;

  } catch (error) {
    logger.error('Subscription creation failed:', error);
    throw error;
  }
};

/**
 * Get user subscription
 * @param {string} userId - User ID
 * @returns {Object} User subscription details
 */
const getUserSubscription = async (userId) => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { user_id: userId },
      include: {
        user: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true
          }
        }
      }
    });

    if (!subscription) {
      // Return default free subscription
      return {
        user_id: userId,
        plan: SUBSCRIPTION_PLAN.FREE,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        price: 0,
        billing_cycle: 'lifetime',
        features: SUBSCRIPTION_FEATURES[SUBSCRIPTION_PLAN.FREE],
        is_default: true
      };
    }

    // Add plan features to subscription
    const planDetails = getSubscriptionPlan(subscription.plan);
    
    return {
      ...subscription,
      features: planDetails.features,
      plan_details: planDetails
    };

  } catch (error) {
    logger.error('Get user subscription failed:', error);
    throw error;
  }
};

/**
 * Update subscription plan
 * @param {string} userId - User ID
 * @param {Object} updateData - Update data
 * @returns {Object} Updated subscription
 */
const updateSubscription = async (userId, updateData) => {
  try {
    const { plan, billing_cycle } = updateData;

    const currentSubscription = await prisma.subscription.findUnique({
      where: { user_id: userId }
    });

    if (!currentSubscription) {
      throw new Error('No subscription found for user');
    }

    const newPlanDetails = getSubscriptionPlan(plan);
    const currentPlanDetails = getSubscriptionPlan(currentSubscription.plan);

    // Handle plan changes
    if (plan !== currentSubscription.plan) {
      let stripeSubscription = null;

      // If changing to/from paid plans, handle Stripe subscription
      if (newPlanDetails.stripe_price_id || currentSubscription.stripe_subscription_id) {
        if (currentSubscription.stripe_subscription_id && newPlanDetails.stripe_price_id) {
          // Update existing Stripe subscription
          stripeSubscription = await updateStripeSubscription(
            currentSubscription.stripe_subscription_id,
            newPlanDetails.stripe_price_id
          );
        } else if (newPlanDetails.stripe_price_id) {
          // Create new Stripe subscription (upgrade from free)
          throw new Error('Please provide payment method for paid plan upgrade');
        } else {
          // Cancel Stripe subscription (downgrade to free)
          await cancelStripeSubscription(currentSubscription.stripe_subscription_id);
        }
      }

      // Calculate proration for immediate plan changes
      const isUpgrade = newPlanDetails.price > currentPlanDetails.price;
      const prorationAmount = calculateProration(currentSubscription, newPlanDetails);

      // Update subscription record
      const updatedSubscription = await prisma.subscription.update({
        where: { user_id: userId },
        data: {
          plan,
          price: newPlanDetails.price,
          billing_cycle: billing_cycle || currentSubscription.billing_cycle,
          stripe_subscription_id: stripeSubscription?.id || null,
          // Immediate upgrade, scheduled downgrade
          ...(isUpgrade && {
            current_period_start: new Date(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          })
        },
        include: {
          user: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true
            }
          }
        }
      });

      logger.info('Subscription updated successfully', {
        subscriptionId: updatedSubscription.id,
        userId,
        oldPlan: currentSubscription.plan,
        newPlan: plan,
        prorationAmount
      });

      // Send notification
      const changeType = isUpgrade ? 'upgraded' : 'downgraded';
      await notificationService.createNotification({
        user_id: userId,
        type: 'SUBSCRIPTION_UPDATED',
        title: 'Subscription Updated',
        message: `Your subscription has been ${changeType} to ${newPlanDetails.name}`,
        metadata: {
          subscription_id: updatedSubscription.id,
          old_plan: currentSubscription.plan,
          new_plan: plan,
          proration_amount: prorationAmount
        },
        send_email: true
      });

      return {
        ...updatedSubscription,
        features: newPlanDetails.features,
        plan_details: newPlanDetails
      };
    }

    return currentSubscription;

  } catch (error) {
    logger.error('Subscription update failed:', error);
    throw error;
  }
};

/**
 * Cancel subscription
 * @param {string} userId - User ID
 * @param {Object} options - Cancellation options
 * @returns {Object} Cancellation result
 */
const cancelSubscription = async (userId, options = {}) => {
  try {
    const { immediate = false, reason = null } = options;

    const subscription = await prisma.subscription.findUnique({
      where: { user_id: userId }
    });

    if (!subscription) {
      throw new Error('No subscription found for user');
    }

    if (subscription.status === SUBSCRIPTION_STATUS.CANCELLED) {
      throw new Error('Subscription is already cancelled');
    }

    // Cancel Stripe subscription if exists
    if (subscription.stripe_subscription_id) {
      await cancelStripeSubscription(subscription.stripe_subscription_id, immediate);
    }

    // Update subscription record
    const cancelledSubscription = await prisma.subscription.update({
      where: { user_id: userId },
      data: {
        status: immediate ? SUBSCRIPTION_STATUS.CANCELLED : SUBSCRIPTION_STATUS.ACTIVE,
        cancelled_at: new Date(),
        cancellation_reason: reason,
        // If not immediate, subscription remains active until period end
        ...(!immediate && {
          status: SUBSCRIPTION_STATUS.ACTIVE
        })
      }
    });

    logger.info('Subscription cancelled', {
      subscriptionId: subscription.id,
      userId,
      immediate,
      reason
    });

    // Send notification
    await notificationService.createNotification({
      user_id: userId,
      type: 'SUBSCRIPTION_CANCELLED',
      title: 'Subscription Cancelled',
      message: immediate 
        ? 'Your subscription has been cancelled immediately'
        : 'Your subscription will be cancelled at the end of the current period',
      metadata: {
        subscription_id: subscription.id,
        immediate,
        end_date: subscription.current_period_end
      },
      send_email: true
    });

    return cancelledSubscription;

  } catch (error) {
    logger.error('Subscription cancellation failed:', error);
    throw error;
  }
};

/**
 * Reactivate cancelled subscription
 * @param {string} userId - User ID
 * @param {Object} reactivationData - Reactivation details
 * @returns {Object} Reactivated subscription
 */
const reactivateSubscription = async (userId, reactivationData = {}) => {
  try {
    const { payment_method_id = null } = reactivationData;

    const subscription = await prisma.subscription.findUnique({
      where: { user_id: userId }
    });

    if (!subscription) {
      throw new Error('No subscription found for user');
    }

    if (subscription.status === SUBSCRIPTION_STATUS.ACTIVE) {
      throw new Error('Subscription is already active');
    }

    const planDetails = getSubscriptionPlan(subscription.plan);

    let stripeSubscription = null;
    let newPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Reactivate Stripe subscription if needed
    if (planDetails.stripe_price_id) {
      if (!payment_method_id) {
        throw new Error('Payment method required to reactivate paid subscription');
      }

      stripeSubscription = await createStripeSubscription({
        user_id: userId,
        price_id: planDetails.stripe_price_id,
        payment_method_id
      });

      newPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
    }

    // Update subscription record
    const reactivatedSubscription = await prisma.subscription.update({
      where: { user_id: userId },
      data: {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        current_period_start: new Date(),
        current_period_end: newPeriodEnd,
        stripe_subscription_id: stripeSubscription?.id || subscription.stripe_subscription_id,
        cancelled_at: null,
        cancellation_reason: null
      }
    });

    logger.info('Subscription reactivated', {
      subscriptionId: subscription.id,
      userId,
      plan: subscription.plan
    });

    // Send notification
    await notificationService.createNotification({
      user_id: userId,
      type: 'SUBSCRIPTION_REACTIVATED',
      title: 'Subscription Reactivated',
      message: `Your ${planDetails.name} subscription has been reactivated!`,
      metadata: {
        subscription_id: subscription.id,
        plan: subscription.plan
      },
      send_email: true
    });

    return {
      ...reactivatedSubscription,
      features: planDetails.features,
      plan_details: planDetails
    };

  } catch (error) {
    logger.error('Subscription reactivation failed:', error);
    throw error;
  }
};

// ================================
// SUBSCRIPTION FEATURES & LIMITS
// ================================

/**
 * Check if user has access to a feature
 * @param {string} userId - User ID
 * @param {string} feature - Feature name
 * @returns {boolean} Has access
 */
const hasFeatureAccess = async (userId, feature) => {
  try {
    const subscription = await getUserSubscription(userId);
    const features = subscription.features || SUBSCRIPTION_FEATURES[SUBSCRIPTION_PLAN.FREE];
    
    return features[feature] === true || (typeof features[feature] === 'number' && features[feature] > 0);

  } catch (error) {
    logger.error('Check feature access failed:', error);
    return false;
  }
};

/**
 * Get feature usage limits for user
 * @param {string} userId - User ID
 * @returns {Object} Feature limits
 */
const getFeatureLimits = async (userId) => {
  try {
    const subscription = await getUserSubscription(userId);
    return subscription.features || SUBSCRIPTION_FEATURES[SUBSCRIPTION_PLAN.FREE];

  } catch (error) {
    logger.error('Get feature limits failed:', error);
    return SUBSCRIPTION_FEATURES[SUBSCRIPTION_PLAN.FREE];
  }
};

/**
 * Check if user can create more listings
 * @param {string} userId - User ID
 * @returns {Object} Listing limit check result
 */
const checkListingLimit = async (userId) => {
  try {
    const [subscription, currentListingCount] = await Promise.all([
      getUserSubscription(userId),
      prisma.listing.count({
        where: {
          vendor_id: userId,
          status: { in: ['ACTIVE', 'DRAFT'] }
        }
      })
    ]);

    const maxListings = subscription.features?.max_listings || 0;
    const canCreate = maxListings === -1 || currentListingCount < maxListings;

    return {
      can_create: canCreate,
      current_count: currentListingCount,
      max_allowed: maxListings,
      remaining: maxListings === -1 ? 'unlimited' : Math.max(0, maxListings - currentListingCount)
    };

  } catch (error) {
    logger.error('Check listing limit failed:', error);
    return {
      can_create: false,
      current_count: 0,
      max_allowed: 0,
      remaining: 0
    };
  }
};

/**
 * Get user's subscription usage statistics
 * @param {string} userId - User ID
 * @returns {Object} Usage statistics
 */
const getSubscriptionUsage = async (userId) => {
  try {
    const subscription = await getUserSubscription(userId);
    const features = subscription.features || SUBSCRIPTION_FEATURES[SUBSCRIPTION_PLAN.FREE];

    // Get current usage counts
    const [
      activeListings,
      draftListings,
      totalImages,
      totalVideos,
      total3DModels,
      featuredListings
    ] = await Promise.all([
      prisma.listing.count({
        where: { vendor_id: userId, status: 'ACTIVE' }
      }),
      prisma.listing.count({
        where: { vendor_id: userId, status: 'DRAFT' }
      }),
      prisma.listingImage.count({
        where: {
          listing: { vendor_id: userId }
        }
      }),
      prisma.listingVideo.count({
        where: {
          listing: { vendor_id: userId }
        }
      }),
      prisma.listing3DModel.count({
        where: {
          listing: { vendor_id: userId }
        }
      }),
      prisma.listing.count({
        where: { vendor_id: userId, is_featured: true }
      })
    ]);

    return {
      listings: {
        active: activeListings,
        draft: draftListings,
        total: activeListings + draftListings,
        limit: features.max_listings,
        percentage_used: features.max_listings === -1 ? 0 : 
          ((activeListings + draftListings) / features.max_listings) * 100
      },
      media: {
        images: {
          total: totalImages,
          limit_per_listing: features.max_images_per_listing
        },
        videos: {
          total: totalVideos,
          limit_per_listing: features.max_videos_per_listing
        },
        models_3d: {
          total: total3DModels,
          limit_per_listing: features.max_3d_models_per_listing
        }
      },
      featured_listings: {
        current: featuredListings,
        limit: features.featured_listings
      },
      features: {
        analytics_access: features.analytics_access,
        promotion_tools: features.promotion_tools,
        priority_support: features.priority_support,
        custom_branding: features.custom_branding
      }
    };

  } catch (error) {
    logger.error('Get subscription usage failed:', error);
    throw error;
  }
};

// ================================
// STRIPE INTEGRATION
// ================================

/**
 * Create Stripe subscription
 * @param {Object} subscriptionData - Stripe subscription data
 * @returns {Object} Stripe subscription
 */
const createStripeSubscription = async (subscriptionData) => {
  try {
    const { user_id, price_id, payment_method_id } = subscriptionData;

    if (!process.env.STRIPE_SECRET_KEY) {
      logger.warn('Stripe not configured, simulating subscription creation');
      return {
        id: `sub_simulated_${Date.now()}`,
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
        status: 'active',
        simulated: true
      };
    }

    // Get user details
    const user = await prisma.user.findUnique({
      where: { id: user_id },
      select: { email: true, first_name: true, last_name: true }
    });

    // Create or get Stripe customer
    let customer;
    try {
      const customers = await stripe.customers.list({
        email: user.email,
        limit: 1
      });

      if (customers.data.length > 0) {
        customer = customers.data[0];
      } else {
        customer = await stripe.customers.create({
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
          metadata: {
            user_id: user_id
          }
        });
      }
    } catch (error) {
      logger.error('Stripe customer creation failed:', error);
      throw new Error('Failed to create payment profile');
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(payment_method_id, {
      customer: customer.id
    });

    // Set as default payment method
    await stripe.customers.update(customer.id, {
      invoice_settings: {
        default_payment_method: payment_method_id
      }
    });

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price_id }],
      default_payment_method: payment_method_id,
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        user_id: user_id
      }
    });

    logger.info('Stripe subscription created', {
      subscriptionId: subscription.id,
      customerId: customer.id,
      userId: user_id
    });

    return subscription;

  } catch (error) {
    logger.error('Stripe subscription creation failed:', error);
    throw error;
  }
};

/**
 * Update Stripe subscription
 * @param {string} subscriptionId - Stripe subscription ID
 * @param {string} newPriceId - New price ID
 * @returns {Object} Updated Stripe subscription
 */
const updateStripeSubscription = async (subscriptionId, newPriceId) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      logger.warn('Stripe not configured, simulating subscription update');
      return {
        id: subscriptionId,
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
        status: 'active',
        simulated: true
      };
    }

    // Get current subscription
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Update subscription with new price
    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      items: [{
        id: subscription.items.data[0].id,
        price: newPriceId
      }],
      proration_behavior: 'create_prorations'
    });

    logger.info('Stripe subscription updated', {
      subscriptionId,
      newPriceId
    });

    return updatedSubscription;

  } catch (error) {
    logger.error('Stripe subscription update failed:', error);
    throw error;
  }
};

/**
 * Cancel Stripe subscription
 * @param {string} subscriptionId - Stripe subscription ID
 * @param {boolean} immediate - Cancel immediately or at period end
 * @returns {Object} Cancelled Stripe subscription
 */
const cancelStripeSubscription = async (subscriptionId, immediate = false) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      logger.warn('Stripe not configured, simulating subscription cancellation');
      return {
        id: subscriptionId,
        status: immediate ? 'canceled' : 'active',
        canceled_at: immediate ? Math.floor(Date.now() / 1000) : null,
        simulated: true
      };
    }

    let cancelledSubscription;

    if (immediate) {
      cancelledSubscription = await stripe.subscriptions.cancel(subscriptionId);
    } else {
      cancelledSubscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true
      });
    }

    logger.info('Stripe subscription cancelled', {
      subscriptionId,
      immediate
    });

    return cancelledSubscription;

  } catch (error) {
    logger.error('Stripe subscription cancellation failed:', error);
    throw error;
  }
};

// ================================
// BILLING & INVOICING
// ================================

/**
 * Get user's billing history
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Object} Billing history
 */
const getBillingHistory = async (userId, options = {}) => {
  try {
    const { page = 1, limit = 20 } = options;

    // Get subscription to find Stripe customer
    const subscription = await prisma.subscription.findUnique({
      where: { user_id: userId }
    });

    if (!subscription?.stripe_subscription_id || !process.env.STRIPE_SECRET_KEY) {
      return {
        invoices: [],
        pagination: {
          current_page: page,
          total_pages: 0,
          total_count: 0,
          per_page: limit
        }
      };
    }

    // Get Stripe subscription to find customer
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
    
    // Get invoices from Stripe
    const invoices = await stripe.invoices.list({
      customer: stripeSubscription.customer,
      limit: limit,
      starting_after: page > 1 ? undefined : undefined // Implement pagination token if needed
    });

    const formattedInvoices = invoices.data.map(invoice => ({
      id: invoice.id,
      amount: invoice.amount_paid / 100, // Convert from cents
      currency: invoice.currency,
      status: invoice.status,
      created_at: new Date(invoice.created * 1000),
      period_start: new Date(invoice.period_start * 1000),
      period_end: new Date(invoice.period_end * 1000),
      invoice_url: invoice.hosted_invoice_url,
      pdf_url: invoice.invoice_pdf,
      description: invoice.lines.data[0]?.description || 'Subscription payment'
    }));

    return {
      invoices: formattedInvoices,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(invoices.total_count / limit),
        total_count: invoices.total_count,
        per_page: limit
      }
    };

  } catch (error) {
    logger.error('Get billing history failed:', error);
    return {
      invoices: [],
      pagination: {
        current_page: page,
        total_pages: 0,
        total_count: 0,
        per_page: limit
      }
    };
  }
};

/**
 * Calculate proration amount for plan changes
 * @param {Object} currentSubscription - Current subscription
 * @param {Object} newPlanDetails - New plan details
 * @returns {number} Proration amount
 */
const calculateProration = (currentSubscription, newPlanDetails) => {
  try {
    const now = new Date();
    const periodStart = new Date(currentSubscription.current_period_start);
    const periodEnd = new Date(currentSubscription.current_period_end);
    
    const totalDays = Math.ceil((periodEnd - periodStart) / (24 * 60 * 60 * 1000));
    const remainingDays = Math.ceil((periodEnd - now) / (24 * 60 * 60 * 1000));
    
    if (remainingDays <= 0) return 0;
    
    const currentDailyRate = currentSubscription.price / totalDays;
    const newDailyRate = newPlanDetails.price / totalDays;
    
    const priceDifference = newDailyRate - currentDailyRate;
    const prorationAmount = priceDifference * remainingDays;
    
    return Math.max(0, prorationAmount);

  } catch (error) {
    logger.error('Calculate proration failed:', error);
    return 0;
  }
};

// ================================
// SUBSCRIPTION MAINTENANCE
// ================================

/**
 * Process subscription renewals
 * @returns {Object} Renewal processing result
 */
const processSubscriptionRenewals = async () => {
  try {
    const now = new Date();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Find subscriptions expiring in the next 24 hours
    const expiringSubscriptions = await prisma.subscription.findMany({
      where: {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        current_period_end: {
          gte: now,
          lte: tomorrow
        }
      },
      include: {
        user: {
          select: { id: true, email: true, first_name: true, last_name: true }
        }
      }
    });

    const results = { renewed: 0, failed: 0, cancelled: 0 };

    for (const subscription of expiringSubscriptions) {
      try {
        if (subscription.cancelled_at) {
          // Cancel subscription if marked for cancellation
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              status: SUBSCRIPTION_STATUS.CANCELLED,
              current_period_end: now
            }
          });
          results.cancelled++;
        } else if (subscription.stripe_subscription_id) {
          // Stripe handles automatic renewal
          results.renewed++;
        } else if (subscription.plan === SUBSCRIPTION_PLAN.FREE) {
          // Extend free subscription
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              current_period_start: subscription.current_period_end,
              current_period_end: new Date(subscription.current_period_end.getTime() + 365 * 24 * 60 * 60 * 1000)
            }
          });
          results.renewed++;
        }
      } catch (error) {
        logger.error('Subscription renewal failed', {
          subscriptionId: subscription.id,
          error: error.message
        });
        results.failed++;
      }
    }

    logger.info('Subscription renewals processed', results);
    return results;

  } catch (error) {
    logger.error('Process subscription renewals failed:', error);
    throw error;
  }
};

/**
 * Send subscription expiration warnings
 * @returns {Object} Warning result
 */
const sendExpirationWarnings = async () => {
  try {
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Find subscriptions expiring in 3 or 7 days
    const expiringSubscriptions = await prisma.subscription.findMany({
      where: {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        cancelled_at: { not: null }, // Only cancelled subscriptions
        current_period_end: {
          gte: threeDaysFromNow,
          lte: sevenDaysFromNow
        }
      },
      include: {
        user: {
          select: { id: true, first_name: true, last_name: true }
        }
      }
    });

    let warningsSent = 0;

    for (const subscription of expiringSubscriptions) {
      const daysUntilExpiry = Math.ceil(
        (subscription.current_period_end - new Date()) / (24 * 60 * 60 * 1000)
      );

      await notificationService.createNotification({
        user_id: subscription.user_id,
        type: 'SUBSCRIPTION_EXPIRING',
        title: 'Subscription Expiring Soon',
        message: `Your subscription will expire in ${daysUntilExpiry} days. Reactivate to continue enjoying premium features.`,
        metadata: {
          subscription_id: subscription.id,
          days_until_expiry: daysUntilExpiry,
          plan: subscription.plan
        },
        send_email: true
      });

      warningsSent++;
    }

    logger.info('Expiration warnings sent', {
      subscriptionsProcessed: expiringSubscriptions.length,
      warningsSent
    });

    return {
      subscriptions_processed: expiringSubscriptions.length,
      warnings_sent: warningsSent
    };

  } catch (error) {
    logger.error('Send expiration warnings failed:', error);
    throw error;
  }
};

// ================================
// ANALYTICS
// ================================

/**
 * Get subscription analytics
 * @param {Object} options - Analytics options
 * @returns {Object} Subscription analytics
 */
const getSubscriptionAnalytics = async (options = {}) => {
  try {
    const {
      start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end_date = new Date()
    } = options;

    const [
      totalSubscriptions,
      activeSubscriptions,
      subscriptionsByPlan,
      revenueStats,
      churnRate
    ] = await Promise.all([
      prisma.subscription.count(),
      prisma.subscription.count({
        where: { status: SUBSCRIPTION_STATUS.ACTIVE }
      }),
      prisma.subscription.groupBy({
        by: ['plan'],
        _count: { plan: true },
        where: { status: SUBSCRIPTION_STATUS.ACTIVE }
      }),
      prisma.subscription.aggregate({
        where: {
          status: SUBSCRIPTION_STATUS.ACTIVE,
          plan: { not: SUBSCRIPTION_PLAN.FREE }
        },
        _sum: { price: true },
        _avg: { price: true }
      }),
      calculateChurnRate(start_date, end_date)
    ]);

    const planDistribution = {};
    subscriptionsByPlan.forEach(item => {
      planDistribution[item.plan] = item._count.plan;
    });

    return {
      summary: {
        total_subscriptions: totalSubscriptions,
        active_subscriptions: activeSubscriptions,
        monthly_recurring_revenue: revenueStats._sum.price || 0,
        average_revenue_per_user: revenueStats._avg.price || 0,
        churn_rate: churnRate
      },
      plan_distribution: planDistribution
    };

  } catch (error) {
    logger.error('Get subscription analytics failed:', error);
    throw error;
  }
};

/**
 * Calculate churn rate for a given period
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {number} Churn rate percentage
 */
const calculateChurnRate = async (startDate, endDate) => {
  try {
    const [cancelledCount, activeStartCount] = await Promise.all([
      prisma.subscription.count({
        where: {
          cancelled_at: {
            gte: startDate,
            lte: endDate
          }
        }
      }),
      prisma.subscription.count({
        where: {
          created_at: { lt: startDate },
          status: SUBSCRIPTION_STATUS.ACTIVE
        }
      })
    ]);

    return activeStartCount > 0 ? (cancelledCount / activeStartCount) * 100 : 0;

  } catch (error) {
    logger.error('Calculate churn rate failed:', error);
    return 0;
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Plan management
  getSubscriptionPlans,
  getSubscriptionPlan,

  // Core subscription functions
  createSubscription,
  getUserSubscription,
  updateSubscription,
  cancelSubscription,
  reactivateSubscription,

  // Feature management
  hasFeatureAccess,
  getFeatureLimits,
  checkListingLimit,
  getSubscriptionUsage,

  // Billing
  getBillingHistory,
  calculateProration,

  // Maintenance
  processSubscriptionRenewals,
  sendExpirationWarnings,

  // Analytics
  getSubscriptionAnalytics,
  calculateChurnRate
};