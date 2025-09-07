-- ================================
-- VOID MARKETPLACE DATABASE MIGRATION
-- Complete database schema setup for PostgreSQL
-- ================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================
-- ENUMS
-- ================================

-- User management enums
CREATE TYPE user_role AS ENUM (
    'SUPER_ADMIN',
    'ADMIN',
    'MODERATOR',
    'VENDOR',
    'USER'
);

CREATE TYPE user_status AS ENUM (
    'ACTIVE',
    'SUSPENDED',
    'BANNED',
    'PENDING_VERIFICATION'
);

-- Listing management enums
CREATE TYPE listing_status AS ENUM (
    'DRAFT',
    'PENDING_APPROVAL',
    'ACTIVE',
    'SOLD',
    'REMOVED',
    'REJECTED'
);

CREATE TYPE listing_condition AS ENUM (
    'NEW',
    'LIKE_NEW',
    'GOOD',
    'FAIR',
    'POOR'
);

-- Transaction enums
CREATE TYPE transaction_status AS ENUM (
    'INITIATED',
    'ESCROW_PENDING',
    'ESCROW_ACTIVE',
    'PAYMENT_RELEASED',
    'COMPLETED',
    'DISPUTED',
    'CANCELLED',
    'REFUNDED'
);

-- Communication enums
CREATE TYPE chat_status AS ENUM (
    'ACTIVE',
    'ARCHIVED',
    'BLOCKED'
);

CREATE TYPE message_type AS ENUM (
    'TEXT',
    'IMAGE',
    'OFFER',
    'COUNTER_OFFER',
    'OFFER_ACCEPTED',
    'OFFER_REJECTED',
    'FILE',
    'SYSTEM'
);

-- Notification enums
CREATE TYPE notification_type AS ENUM (
    'CHAT_MESSAGE',
    'OFFER_RECEIVED',
    'OFFER_ACCEPTED',
    'OFFER_REJECTED',
    'PAYMENT_RECEIVED',
    'PRODUCT_SOLD',
    'ADMIN_ALERT',
    'SYSTEM_UPDATE',
    'LISTING_APPROVED',
    'LISTING_REJECTED',
    'VENDOR_VERIFIED',
    'TRANSACTION_UPDATE'
);

-- Subscription enums
CREATE TYPE subscription_plan AS ENUM (
    'FREE',
    'BASIC',
    'PREMIUM',
    'ENTERPRISE'
);

CREATE TYPE subscription_status AS ENUM (
    'ACTIVE',
    'CANCELLED',
    'EXPIRED',
    'PENDING'
);

-- Promotion enums
CREATE TYPE promotion_type AS ENUM (
    'PERCENTAGE_DISCOUNT',
    'FIXED_AMOUNT',
    'FREE_SHIPPING',
    'BUY_ONE_GET_ONE'
);

-- Interaction enums
CREATE TYPE interaction_type AS ENUM (
    'VIEW',
    'LIKE',
    'SHARE',
    'PURCHASE',
    'CART_ADD',
    'SEARCH_CLICK'
);

-- ================================
-- CORE TABLES
-- ================================

-- Users table
CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    avatar_url TEXT,
    bio TEXT,
    location VARCHAR(255),
    role user_role DEFAULT 'USER'::user_role,
    status user_status DEFAULT 'PENDING_VERIFICATION'::user_status,
    is_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMP,
    last_login TIMESTAMP,
    
    -- Vendor-specific fields
    business_name VARCHAR(255),
    business_address TEXT,
    tax_id VARCHAR(100),
    vendor_verified BOOLEAN DEFAULT FALSE,
    
    -- Preferences
    notification_preferences JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Categories table
CREATE TABLE categories (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    parent_id TEXT REFERENCES categories(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Listings table
CREATE TABLE listings (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    condition listing_condition NOT NULL,
    status listing_status DEFAULT 'DRAFT'::listing_status,
    category_id TEXT NOT NULL REFERENCES categories(id),
    vendor_id TEXT NOT NULL REFERENCES users(id),
    quantity INTEGER DEFAULT 1,
    sku VARCHAR(100),
    tags TEXT[] DEFAULT '{}',
    weight DECIMAL(8, 3),
    dimensions TEXT,
    location VARCHAR(255),
    is_negotiable BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    views_count INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,
    search_rank_score DECIMAL(5, 4),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Listing images
CREATE TABLE listing_images (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    alt_text TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    order_pos INTEGER DEFAULT 0,
    file_size INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Listing videos
CREATE TABLE listing_videos (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    thumbnail_url TEXT,
    duration INTEGER,
    file_size INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Listing 3D models
CREATE TABLE listing_3d_models (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    file_type VARCHAR(10) NOT NULL,
    file_size INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Listing embeddings for AI search
CREATE TABLE listing_embeddings (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    embedding_type VARCHAR(50) NOT NULL,
    embedding_vector TEXT NOT NULL, -- JSON string of vector array
    source_content TEXT,
    source_url TEXT,
    confidence_score DECIMAL(3, 2) DEFAULT 1.0,
    model_version VARCHAR(100) DEFAULT 'text-embedding-ada-002',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(listing_id, embedding_type, source_url)
);

-- ================================
-- CHAT AND MESSAGING
-- ================================

-- Chats table
CREATE TABLE chats (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    buyer_id TEXT NOT NULL REFERENCES users(id),
    vendor_id TEXT NOT NULL REFERENCES users(id),
    status chat_status DEFAULT 'ACTIVE'::chat_status,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(listing_id, buyer_id)
);

-- Messages table
CREATE TABLE messages (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id),
    type message_type DEFAULT 'TEXT'::message_type,
    content TEXT,
    offer_amount DECIMAL(10, 2),
    metadata JSONB,
    reply_to_id TEXT REFERENCES messages(id),
    is_read BOOLEAN DEFAULT FALSE,
    edited_at TIMESTAMP,
    deleted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ================================
-- TRANSACTIONS AND PAYMENTS
-- ================================

-- Transactions table
CREATE TABLE transactions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    buyer_id TEXT NOT NULL REFERENCES users(id),
    vendor_id TEXT NOT NULL REFERENCES users(id),
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(10, 2) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    platform_fee DECIMAL(10, 2) DEFAULT 0,
    vendor_amount DECIMAL(10, 2),
    discount_amount DECIMAL(10, 2) DEFAULT 0,
    status transaction_status DEFAULT 'INITIATED'::transaction_status,
    payment_method VARCHAR(100),
    payment_reference TEXT,
    payment_intent_id TEXT,
    stripe_payment_id TEXT,
    promotion_code VARCHAR(100),
    shipping_address JSONB,
    tracking_number VARCHAR(255),
    carrier VARCHAR(100),
    estimated_delivery TIMESTAMP,
    escrow_started_at TIMESTAMP,
    escrow_released_at TIMESTAMP,
    completed_at TIMESTAMP,
    refund_amount DECIMAL(10, 2),
    refund_reason TEXT,
    refund_type VARCHAR(50),
    refunded_at TIMESTAMP,
    refund_processed_by TEXT REFERENCES users(id),
    stripe_refund_id TEXT,
    admin_notes TEXT,
    notes TEXT,
    transaction_hash TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ================================
-- REVIEWS AND RATINGS
-- ================================

-- Reviews table
CREATE TABLE reviews (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    transaction_id TEXT REFERENCES transactions(id),
    listing_id TEXT NOT NULL REFERENCES listings(id),
    reviewer_id TEXT NOT NULL REFERENCES users(id),
    reviewee_id TEXT NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(transaction_id, reviewer_id)
);

-- ================================
-- NOTIFICATIONS
-- ================================

-- Notifications table
CREATE TABLE notifications (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id),
    type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB,
    priority VARCHAR(20) DEFAULT 'normal',
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    delivery_status JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ================================
-- SUBSCRIPTIONS AND BILLING
-- ================================

-- Subscriptions table
CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id),
    plan subscription_plan NOT NULL,
    status subscription_status DEFAULT 'PENDING'::subscription_status,
    price DECIMAL(10, 2) NOT NULL,
    billing_cycle VARCHAR(20) NOT NULL,
    current_period_start TIMESTAMP NOT NULL,
    current_period_end TIMESTAMP NOT NULL,
    cancelled_at TIMESTAMP,
    stripe_subscription_id TEXT,
    stripe_customer_id TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ================================
-- PROMOTIONS AND DISCOUNTS
-- ================================

-- Promotions table
CREATE TABLE promotions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type promotion_type NOT NULL,
    discount_value DECIMAL(10, 2) NOT NULL,
    minimum_amount DECIMAL(10, 2),
    usage_limit INTEGER,
    usage_count INTEGER DEFAULT 0,
    valid_from TIMESTAMP NOT NULL,
    valid_until TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Promotion items (specific products eligible for promotion)
CREATE TABLE promotion_items (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    promotion_id TEXT NOT NULL REFERENCES promotions(id),
    listing_id TEXT NOT NULL REFERENCES listings(id),
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(promotion_id, listing_id)
);

-- ================================
-- USER INTERACTIONS AND ANALYTICS
-- ================================

-- User interactions table
CREATE TABLE user_interactions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id),
    listing_id TEXT NOT NULL REFERENCES listings(id),
    interaction_type interaction_type NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Search analytics table
CREATE TABLE search_analytics (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT REFERENCES users(id),
    query_text TEXT,
    query_type VARCHAR(50) DEFAULT 'text',
    filters_applied JSONB DEFAULT '{}',
    results_count INTEGER DEFAULT 0,
    clicked_result_id TEXT,
    session_id TEXT,
    ip_address INET,
    user_agent TEXT,
    search_duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- User search preferences
CREATE TABLE user_search_preferences (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id),
    preferred_categories TEXT[] DEFAULT '{}',
    price_range_min DECIMAL(10, 2),
    price_range_max DECIMAL(10, 2),
    preferred_locations TEXT[] DEFAULT '{}',
    search_history JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Search suggestions
CREATE TABLE search_suggestions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    category_id TEXT REFERENCES categories(id),
    suggestion_text VARCHAR(255) NOT NULL,
    search_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ================================
-- ADMIN AND MODERATION
-- ================================

-- Admin actions table
CREATE TABLE admin_actions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    admin_id TEXT NOT NULL REFERENCES users(id),
    action_type VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Error logs table
CREATE TABLE error_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    error_type VARCHAR(255),
    error_message TEXT,
    stack_trace TEXT,
    context JSONB,
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ================================
-- INDEXES FOR PERFORMANCE
-- ================================

-- User indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_created_at ON users(created_at);

-- Listing indexes
CREATE INDEX idx_listings_vendor_id ON listings(vendor_id);
CREATE INDEX idx_listings_category_id ON listings(category_id);
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_price ON listings(price);
CREATE INDEX idx_listings_created_at ON listings(created_at);
CREATE INDEX idx_listings_updated_at ON listings(updated_at);
CREATE INDEX idx_listings_location ON listings(location);
CREATE INDEX idx_listings_is_featured ON listings(is_featured);
CREATE INDEX idx_listings_views_count ON listings(views_count);

-- Full-text search index for listings
CREATE INDEX idx_listings_search ON listings USING gin(to_tsvector('english', title || ' ' || description));

-- Chat and message indexes
CREATE INDEX idx_chats_buyer_id ON chats(buyer_id);
CREATE INDEX idx_chats_vendor_id ON chats(vendor_id);
CREATE INDEX idx_chats_listing_id ON chats(listing_id);
CREATE INDEX idx_chats_status ON chats(status);
CREATE INDEX idx_chats_updated_at ON chats(updated_at);

CREATE INDEX idx_messages_chat_id ON messages(chat_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_is_read ON messages(is_read);

-- Transaction indexes
CREATE INDEX idx_transactions_buyer_id ON transactions(buyer_id);
CREATE INDEX idx_transactions_vendor_id ON transactions(vendor_id);
CREATE INDEX idx_transactions_listing_id ON transactions(listing_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_payment_intent_id ON transactions(payment_intent_id);

-- Notification indexes
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- Analytics indexes
CREATE INDEX idx_user_interactions_user_id ON user_interactions(user_id);
CREATE INDEX idx_user_interactions_listing_id ON user_interactions(listing_id);
CREATE INDEX idx_user_interactions_type ON user_interactions(interaction_type);
CREATE INDEX idx_user_interactions_created_at ON user_interactions(created_at);

CREATE INDEX idx_search_analytics_user_id ON search_analytics(user_id);
CREATE INDEX idx_search_analytics_query_type ON search_analytics(query_type);
CREATE INDEX idx_search_analytics_created_at ON search_analytics(created_at);

-- Embedding indexes
CREATE INDEX idx_listing_embeddings_listing_id ON listing_embeddings(listing_id);
CREATE INDEX idx_listing_embeddings_type ON listing_embeddings(embedding_type);

-- ================================
-- CONSTRAINTS
-- ================================

-- Ensure chat participants are different
ALTER TABLE chats ADD CONSTRAINT chk_chat_different_participants 
CHECK (buyer_id != vendor_id);

-- Ensure review rating is valid
ALTER TABLE reviews ADD CONSTRAINT chk_review_rating 
CHECK (rating >= 1 AND rating <= 5);

-- Ensure transaction amounts are positive
ALTER TABLE transactions ADD CONSTRAINT chk_transaction_positive_amounts 
CHECK (total_amount >= 0 AND platform_fee >= 0);

-- Ensure listing price is positive
ALTER TABLE listings ADD CONSTRAINT chk_listing_positive_price 
CHECK (price > 0);

-- Ensure subscription price is non-negative
ALTER TABLE subscriptions ADD CONSTRAINT chk_subscription_price 
CHECK (price >= 0);

-- ================================
-- TRIGGERS FOR UPDATED_AT
-- ================================

-- Function to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_listings_updated_at BEFORE UPDATE ON listings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chats_updated_at BEFORE UPDATE ON chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_listing_embeddings_updated_at BEFORE UPDATE ON listing_embeddings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_search_preferences_updated_at BEFORE UPDATE ON user_search_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_search_suggestions_updated_at BEFORE UPDATE ON search_suggestions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================
-- INITIAL DATA SEEDING
-- ================================

-- Insert default categories
INSERT INTO categories (name, description) VALUES
('Electronics', 'Electronic devices and gadgets'),
('Fashion', 'Clothing, shoes, and accessories'),
('Home & Garden', 'Home decor and garden supplies'),
('Sports & Outdoors', 'Sports equipment and outdoor gear'),
('Books & Media', 'Books, movies, and music'),
('Toys & Games', 'Toys and gaming equipment'),
('Automotive', 'Car parts and accessories'),
('Health & Beauty', 'Health and beauty products'),
('Collectibles', 'Rare and collectible items'),
('Other', 'Miscellaneous items')
ON CONFLICT (name) DO NOTHING;

-- ================================
-- VIEWS FOR COMMON QUERIES
-- ================================

-- Active listings with vendor info
CREATE OR REPLACE VIEW active_listings_view AS
SELECT 
    l.*,
    u.username as vendor_username,
    u.business_name,
    u.vendor_verified,
    c.name as category_name,
    (SELECT url FROM listing_images WHERE listing_id = l.id AND is_primary = true LIMIT 1) as primary_image_url,
    (SELECT COUNT(*) FROM reviews WHERE listing_id = l.id) as review_count,
    (SELECT AVG(rating) FROM reviews WHERE listing_id = l.id) as average_rating
FROM listings l
JOIN users u ON l.vendor_id = u.id
JOIN categories c ON l.category_id = c.id
WHERE l.status = 'ACTIVE';

-- User transaction summary
CREATE OR REPLACE VIEW user_transaction_summary AS
SELECT 
    u.id as user_id,
    u.email,
    u.role,
    COUNT(t_buyer.id) as transactions_as_buyer,
    COUNT(t_vendor.id) as transactions_as_vendor,
    COALESCE(SUM(t_buyer.total_amount), 0) as total_spent,
    COALESCE(SUM(t_vendor.vendor_amount), 0) as total_earned
FROM users u
LEFT JOIN transactions t_buyer ON u.id = t_buyer.buyer_id
LEFT JOIN transactions t_vendor ON u.id = t_vendor.vendor_id
GROUP BY u.id, u.email, u.role;

-- ================================
-- COMPLETION MESSAGE
-- ================================

-- Log migration completion
DO $$ 
BEGIN 
    RAISE NOTICE '✅ VOID Marketplace database migration completed successfully!';
    RAISE NOTICE '📊 Tables created: Users, Listings, Chats, Messages, Transactions, Reviews, Notifications, and more';
    RAISE NOTICE '🔍 Indexes created for optimal performance';
    RAISE NOTICE '🛡️  Constraints and triggers configured for data integrity';
    RAISE NOTICE '🌱 Initial categories seeded';
    RAISE NOTICE '📈 Views created for common queries';
END $$;