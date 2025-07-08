// apps/backend/prisma/seed.js
// Database seeding script for VOID Marketplace

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  try {
    // ================================
    // CATEGORIES
    // ================================
    console.log('📂 Creating categories...');

    const categories = [
    {
        id: 'cat_fashion',
        name: 'Fashion',
        description: 'Clothing, apparel, and fashion accessories for all styles'
    },
    {
        id: 'cat_jewelry',
        name: 'Jewelry',
        description: 'Rings, necklaces, bracelets, watches, and precious accessories'
    },
    {
        id: 'cat_beauty',
        name: 'Beauty',
        description: 'Cosmetics, skincare, haircare, and personal care products'
    },
    {
        id: 'cat_kids',
        name: 'Kids',
        description: 'Children\'s products, toys, baby items, and kids\' essentials'
    },
    {
        id: 'cat_health',
        name: 'Health',
        description: 'Health products, fitness equipment, and wellness items'
    },
    {
        id: 'cat_sports',
        name: 'Sports',
        description: 'Sports equipment, outdoor gear, and athletic accessories'
    },
    {
        id: 'cat_gaming',
        name: 'Gaming',
        description: 'Video games, gaming consoles, accessories, and collectibles'
    },
    {
        id: 'cat_electronics',
        name: 'Electronics',
        description: 'Phones, computers, gadgets, and electronic devices'
    },
    {
        id: 'cat_appliance',
        name: 'Appliance',
        description: 'Home appliances, kitchen equipment, and household devices'
    },
    {
        id: 'cat_office',
        name: 'Office',
        description: 'Office supplies, business equipment, and workplace essentials'
    },
    {
        id: 'cat_properties',
        name: 'Properties',
        description: 'Real estate, rentals, land, and property listings'
    },
    {
        id: 'cat_vehicles',
        name: 'Vehicles',
        description: 'Cars, motorcycles, boats, and automotive equipment'
    },
    {
        id: 'cat_industrial',
        name: 'Industrial',
        description: 'Industrial equipment, machinery, and commercial tools'
    },
    {
        id: 'cat_construction',
        name: 'Construction & Repairs',
        description: 'Construction tools, building materials, and repair equipment'
    }
    ];

    for (const category of categories) {
      await prisma.category.upsert({
        where: { id: category.id },
        update: {},
        create: category
      });
    }

    console.log(`✅ Created ${categories.length} categories`);

    // ================================
    // USERS (TEST ACCOUNTS)
    // ================================
    console.log('👥 Creating test users...');

    const passwordHash = await bcrypt.hash('Password123!', 12);

    const users = [
      // Super Admin
      {
        id: 'user_super_admin',
        email: 'admin@void-marketplace.com',
        username: 'superadmin',
        password_hash: passwordHash,
        first_name: 'Super',
        last_name: 'Admin',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        is_verified: true,
        vendor_verified: true
      },
      // Regular Admin
      {
        id: 'user_admin',
        email: 'admin.user@void-marketplace.com',
        username: 'admin',
        password_hash: passwordHash,
        first_name: 'Admin',
        last_name: 'User',
        role: 'ADMIN',
        status: 'ACTIVE',
        is_verified: true,
        vendor_verified: false
      },
      // Moderator
      {
        id: 'user_moderator',
        email: 'moderator@void-marketplace.com',
        username: 'moderator',
        password_hash: passwordHash,
        first_name: 'Content',
        last_name: 'Moderator',
        role: 'MODERATOR',
        status: 'ACTIVE',
        is_verified: true,
        vendor_verified: false
      },
      // Test Vendors
      {
        id: 'user_vendor_tech',
        email: 'tech.vendor@void-marketplace.com',
        username: 'techvendor',
        password_hash: passwordHash,
        first_name: 'Tech',
        last_name: 'Vendor',
        role: 'VENDOR',
        status: 'ACTIVE',
        is_verified: true,
        vendor_verified: true,
        business_name: 'TechGadgets Pro',
        business_address: '123 Tech Street, Silicon Valley, CA',
        tax_id: 'TAX123456789'
      },
      {
        id: 'user_vendor_fashion',
        email: 'fashion.vendor@void-marketplace.com',
        username: 'fashionvendor',
        password_hash: passwordHash,
        first_name: 'Fashion',
        last_name: 'Vendor',
        role: 'VENDOR',
        status: 'ACTIVE',
        is_verified: true,
        vendor_verified: true,
        business_name: 'StyleHub Fashion',
        business_address: '456 Fashion Ave, New York, NY',
        tax_id: 'TAX987654321'
      },
      {
        id: 'user_vendor_pending',
        email: 'pending.vendor@void-marketplace.com',
        username: 'pendingvendor',
        password_hash: passwordHash,
        first_name: 'Pending',
        last_name: 'Vendor',
        role: 'VENDOR',
        status: 'ACTIVE',
        is_verified: true,
        vendor_verified: false,
        business_name: 'New Business LLC',
        business_address: '789 Startup Blvd, Austin, TX'
      },
      // Test Users
      {
        id: 'user_buyer_1',
        email: 'buyer1@void-marketplace.com',
        username: 'buyer1',
        password_hash: passwordHash,
        first_name: 'John',
        last_name: 'Buyer',
        role: 'USER',
        status: 'ACTIVE',
        is_verified: true,
        vendor_verified: false
      },
      {
        id: 'user_buyer_2',
        email: 'buyer2@void-marketplace.com',
        username: 'buyer2',
        password_hash: passwordHash,
        first_name: 'Jane',
        last_name: 'Customer',
        role: 'USER',
        status: 'ACTIVE',
        is_verified: true,
        vendor_verified: false
      },
      {
        id: 'user_unverified',
        email: 'unverified@void-marketplace.com',
        username: 'unverified',
        password_hash: passwordHash,
        first_name: 'Unverified',
        last_name: 'User',
        role: 'USER',
        status: 'PENDING_VERIFICATION',
        is_verified: false,
        vendor_verified: false
      }
    ];

    for (const user of users) {
      await prisma.user.upsert({
        where: { email: user.email },
        update: {},
        create: user
      });
    }

    console.log(`✅ Created ${users.length} test users`);

    // ================================
    // SAMPLE LISTINGS
    // ================================
    console.log('📝 Creating sample listings...');

    const listings = [
      // Tech Vendor Listings
      {
        id: 'listing_iphone_15',
        title: 'iPhone 15 Pro Max - 256GB Space Black',
        description: 'Brand new iPhone 15 Pro Max in Space Black color with 256GB storage. Still in original packaging with all accessories. Never used, received as a gift but prefer Android. Includes charger, cable, and documentation.',
        price: 1099.99,
        condition: 'NEW',
        category_id: 'cat_electronics',
        vendor_id: 'user_vendor_tech',
        quantity: 1,
        sku: 'IPHONE15PM256SB',
        tags: ['iPhone', 'Apple', 'smartphone', 'mobile', 'new'],
        location: 'San Francisco, CA',
        is_negotiable: true,
        is_featured: true,
        status: 'ACTIVE'
      },
      {
        id: 'listing_macbook_air',
        title: 'MacBook Air M2 - 13" Space Gray',
        description: 'Excellent condition MacBook Air with M2 chip, 8GB RAM, 256GB SSD. Used for light work for 6 months. No scratches, dents, or issues. Battery health at 95%. Includes original charger and box.',
        price: 899.99,
        condition: 'LIKE_NEW',
        category_id: 'cat_electronics',
        vendor_id: 'user_vendor_tech',
        quantity: 1,
        sku: 'MACBOOK-AIR-M2-256',
        tags: ['MacBook', 'Apple', 'laptop', 'M2', 'ultrabook'],
        location: 'San Francisco, CA',
        is_negotiable: true,
        is_featured: false,
        status: 'ACTIVE'
      },
      {
        id: 'listing_gaming_pc',
        title: 'Custom Gaming PC - RTX 4070, Ryzen 7',
        description: 'High-performance gaming PC built 3 months ago. Features: AMD Ryzen 7 5800X, NVIDIA RTX 4070, 32GB DDR4 RAM, 1TB NVMe SSD, 2TB HDD. Perfect for gaming, streaming, and content creation. Runs all modern games at 1440p high settings.',
        price: 1299.99,
        condition: 'LIKE_NEW',
        category_id: 'cat_electronics',
        vendor_id: 'user_vendor_tech',
        quantity: 1,
        tags: ['gaming', 'PC', 'RTX', 'Ryzen', 'custom build'],
        location: 'San Jose, CA',
        is_negotiable: true,
        is_featured: true,
        status: 'ACTIVE'
      },

      // Fashion Vendor Listings
      {
        id: 'listing_designer_dress',
        title: 'Vintage Chanel Black Dress - Size 8',
        description: 'Authentic vintage Chanel little black dress from the 1980s. Size 8, excellent condition with minimal wear. Perfect for special occasions. Includes authentication certificate. A timeless piece for any wardrobe.',
        price: 1899.99,
        condition: 'GOOD',
        category_id: 'cat_fashion',
        vendor_id: 'user_vendor_fashion',
        quantity: 1,
        sku: 'CHANEL-DRESS-80S-8',
        tags: ['Chanel', 'vintage', 'dress', 'designer', 'luxury'],
        location: 'New York, NY',
        is_negotiable: true,
        is_featured: true,
        status: 'ACTIVE'
      },
      {
        id: 'listing_sneakers',
        title: 'Air Jordan 1 Retro High - Chicago (2015)',
        description: 'Classic Air Jordan 1 in the iconic Chicago colorway from 2015 release. Size 10.5, worn handful of times, well maintained. Original box included. Small scuff on right toe but overall great condition.',
        price: 399.99,
        condition: 'GOOD',
        category_id: 'cat_fashion',
        vendor_id: 'user_vendor_fashion',
        quantity: 1,
        sku: 'AJ1-CHICAGO-2015-105',
        tags: ['Jordan', 'Nike', 'sneakers', 'Chicago', 'retro'],
        location: 'Brooklyn, NY',
        is_negotiable: true,
        is_featured: false,
        status: 'ACTIVE'
      },

      // Pending Vendor Listings (will be pending approval)
      {
        id: 'listing_pending_watch',
        title: 'Rolex Submariner - Date 116610LN',
        description: 'Authentic Rolex Submariner with date, purchased in 2020. Excellent condition, serviced last year. Includes box, papers, and warranty card. Perfect timepiece for collectors.',
        price: 8999.99,
        condition: 'LIKE_NEW',
        category_id: 'cat_collectibles',
        vendor_id: 'user_vendor_pending',
        quantity: 1,
        tags: ['Rolex', 'watch', 'luxury', 'Submariner', 'Swiss'],
        location: 'Austin, TX',
        is_negotiable: false,
        is_featured: false,
        status: 'PENDING_APPROVAL'
      },

      // Draft Listing
      {
        id: 'listing_draft_guitar',
        title: 'Fender Stratocaster Electric Guitar',
        description: 'Classic Fender Stratocaster in sunburst finish. Great condition, recently restrung.',
        price: 599.99,
        condition: 'GOOD',
        category_id: 'cat_other',
        vendor_id: 'user_vendor_tech',
        quantity: 1,
        tags: ['guitar', 'Fender', 'music'],
        location: 'San Francisco, CA',
        is_negotiable: true,
        is_featured: false,
        status: 'DRAFT'
      }
    ];

    for (const listing of listings) {
      await prisma.listing.upsert({
        where: { id: listing.id },
        update: {},
        create: listing
      });
    }

    console.log(`✅ Created ${listings.length} sample listings`);

    // ================================
    // SAMPLE CHATS AND MESSAGES
    // ================================
    console.log('💬 Creating sample chats and messages...');

    const chat1 = await prisma.chat.upsert({
      where: { id: 'chat_iphone_inquiry' },
      update: {},
      create: {
        id: 'chat_iphone_inquiry',
        listing_id: 'listing_iphone_15',
        buyer_id: 'user_buyer_1',
        vendor_id: 'user_vendor_tech',
        status: 'ACTIVE'
      }
    });

    const messages = [
      {
        chat_id: 'chat_iphone_inquiry',
        sender_id: 'user_buyer_1',
        type: 'TEXT',
        content: 'Hi! Is this iPhone still available? Can you provide more details about the condition?',
        is_read: true
      },
      {
        chat_id: 'chat_iphone_inquiry',
        sender_id: 'user_vendor_tech',
        type: 'TEXT',
        content: 'Yes, it\'s still available! It\'s brand new, never been used. Still in original sealed packaging.',
        is_read: true
      },
      {
        chat_id: 'chat_iphone_inquiry',
        sender_id: 'user_buyer_1',
        type: 'OFFER',
        content: 'Would you consider $950 for it?',
        offer_amount: 950.00,
        is_read: false
      }
    ];

    for (const message of messages) {
      await prisma.message.create({
        data: message
      });
    }

    console.log(`✅ Created sample chat with ${messages.length} messages`);

    // ================================
    // SAMPLE REVIEWS
    // ================================
    console.log('⭐ Creating sample reviews...');

    const reviews = [
      {
        listing_id: 'listing_macbook_air',
        reviewer_id: 'user_buyer_2',
        reviewee_id: 'user_vendor_tech',
        rating: 5,
        comment: 'Excellent condition as described! Fast shipping and great communication. Highly recommend this seller.',
        is_verified: true
      },
      {
        listing_id: 'listing_sneakers',
        reviewer_id: 'user_buyer_1',
        reviewee_id: 'user_vendor_fashion',
        rating: 4,
        comment: 'Good condition sneakers, exactly as described. Minor scuff as mentioned but overall very happy with the purchase.',
        is_verified: true
      }
    ];

    for (const review of reviews) {
      await prisma.review.create({
        data: review
      });
    }

    console.log(`✅ Created ${reviews.length} sample reviews`);

    // ================================
    // SAMPLE USER INTERACTIONS
    // ================================
    console.log('👆 Creating sample user interactions...');

    const interactions = [
      {
        user_id: 'user_buyer_1',
        listing_id: 'listing_iphone_15',
        interaction_type: 'VIEW'
      },
      {
        user_id: 'user_buyer_1',
        listing_id: 'listing_iphone_15',
        interaction_type: 'LIKE'
      },
      {
        user_id: 'user_buyer_2',
        listing_id: 'listing_macbook_air',
        interaction_type: 'VIEW'
      },
      {
        user_id: 'user_buyer_2',
        listing_id: 'listing_gaming_pc',
        interaction_type: 'VIEW'
      },
      {
        user_id: 'user_buyer_2',
        listing_id: 'listing_gaming_pc',
        interaction_type: 'LIKE'
      }
    ];

    for (const interaction of interactions) {
      await prisma.userInteraction.create({
        data: interaction
      });
    }

    // Update listing stats
    await prisma.listing.update({
      where: { id: 'listing_iphone_15' },
      data: { views_count: 15, likes_count: 3 }
    });

    await prisma.listing.update({
      where: { id: 'listing_macbook_air' },
      data: { views_count: 8, likes_count: 1 }
    });

    await prisma.listing.update({
      where: { id: 'listing_gaming_pc' },
      data: { views_count: 12, likes_count: 2 }
    });

    console.log(`✅ Created ${interactions.length} user interactions`);

    // ================================
    // SAMPLE NOTIFICATIONS
    // ================================
    console.log('🔔 Creating sample notifications...');

    const notifications = [
      {
        user_id: 'user_vendor_tech',
        type: 'OFFER_RECEIVED',
        title: 'New Offer Received',
        message: 'John Buyer made an offer of $950 for your iPhone 15 Pro Max',
        is_read: false
      },
      {
        user_id: 'user_buyer_1',
        type: 'CHAT_MESSAGE',
        title: 'New Message',
        message: 'Tech Vendor replied to your message about iPhone 15 Pro Max',
        is_read: true
      },
      {
        user_id: 'user_vendor_pending',
        type: 'ADMIN_ALERT',
        title: 'Listing Under Review',
        message: 'Your listing "Rolex Submariner" is being reviewed by our team',
        is_read: false
      }
    ];

    for (const notification of notifications) {
      await prisma.notification.create({
        data: notification
      });
    }

    console.log(`✅ Created ${notifications.length} notifications`);

    // ================================
    // SAMPLE SUBSCRIPTION
    // ================================
    console.log('💳 Creating sample subscriptions...');

    const subscription = {
      user_id: 'user_vendor_tech',
      plan: 'PREMIUM',
      status: 'ACTIVE',
      price: 29.99,
      billing_cycle: 'monthly',
      current_period_start: new Date(),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
    };

    await prisma.subscription.upsert({
      where: { user_id: subscription.user_id },
      update: {},
      create: subscription
    });

    console.log('✅ Created sample subscription');

    // ================================
    // SAMPLE PROMOTION
    // ================================
    console.log('🎟️ Creating sample promotion...');

    const promotion = {
      code: 'WELCOME10',
      name: 'Welcome Discount',
      description: 'Get 10% off your first purchase',
      type: 'PERCENTAGE_DISCOUNT',
      discount_value: 10.00,
      minimum_amount: 50.00,
      usage_limit: 100,
      usage_count: 5,
      valid_from: new Date(),
      valid_until: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
      is_active: true
    };

    await prisma.promotion.upsert({
      where: { code: promotion.code },
      update: {},
      create: promotion
    });

    console.log('✅ Created sample promotion');

    console.log('\n🎉 Database seeding completed successfully!');
    console.log('\n📋 Test Account Summary:');
    console.log('👑 Super Admin: admin@void-marketplace.com (Password123!)');
    console.log('🛡️  Admin: admin.user@void-marketplace.com (Password123!)');
    console.log('🔍 Moderator: moderator@void-marketplace.com (Password123!)');
    console.log('🏪 Tech Vendor: tech.vendor@void-marketplace.com (Password123!)');
    console.log('👗 Fashion Vendor: fashion.vendor@void-marketplace.com (Password123!)');
    console.log('⏳ Pending Vendor: pending.vendor@void-marketplace.com (Password123!)');
    console.log('🛒 Buyer 1: buyer1@void-marketplace.com (Password123!)');
    console.log('🛒 Buyer 2: buyer2@void-marketplace.com (Password123!)');
    console.log('\n🏷️  Sample Data Created:');
    console.log(`📂 ${categories.length} categories`);
    console.log(`👥 ${users.length} users`);
    console.log(`📝 ${listings.length} listings`);
    console.log(`💬 1 chat thread with ${messages.length} messages`);
    console.log(`⭐ ${reviews.length} reviews`);
    console.log(`👆 ${interactions.length} user interactions`);
    console.log(`🔔 ${notifications.length} notifications`);
    console.log(`💳 1 subscription`);
    console.log(`🎟️  1 promotion`);

  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });