-- apps/backend/migrations/init.sql
-- Database initialization script for VOID Marketplace
-- This script sets up the database extensions and initial data

-- ================================
-- EXTENSIONS
-- ================================

-- Enable UUID extension for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgvector extension for AI embeddings (if available)
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable full-text search extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ================================
-- INDEXES FOR PERFORMANCE
-- ================================

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_vendor_verified ON users(vendor_verified);

-- Listing indexes
CREATE INDEX IF NOT EXISTS idx_listings_vendor_id ON listings(vendor_id);
CREATE INDEX IF NOT EXISTS idx_listings_category_id ON listings(category_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_condition ON listings(condition);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_created_at ON listings(created_at);
CREATE INDEX IF NOT EXISTS idx_listings_updated_at ON listings(updated_at);
CREATE INDEX IF NOT EXISTS idx_listings_is_featured ON listings(is_featured);
CREATE INDEX IF NOT EXISTS idx_listings_location ON listings(location);

-- Full-text search indexes
CREATE INDEX IF NOT EXISTS idx_listings_title_trgm ON listings USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_listings_description_trgm ON listings USING gin(description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_listings_tags_gin ON listings USING gin(tags);

-- Transaction indexes
CREATE INDEX IF NOT EXISTS idx_transactions_buyer_id ON transactions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_vendor_id ON transactions(vendor_id);
CREATE INDEX IF NOT EXISTS idx_transactions_listing_id ON transactions(listing_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);

-- Chat and message indexes
CREATE INDEX IF NOT EXISTS idx_chats_buyer_id ON chats(buyer_id);
CREATE INDEX IF NOT EXISTS idx_chats_vendor_id ON chats(vendor_id);
CREATE INDEX IF NOT EXISTS idx_chats_listing_id ON chats(listing_id);
CREATE INDEX IF NOT EXISTS idx_chats_status ON chats(status);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON messages(is_read);

-- Notification indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

-- Review indexes
CREATE INDEX IF NOT EXISTS idx_reviews_listing_id ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id ON reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_id ON reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);

-- User interaction indexes
CREATE INDEX IF NOT EXISTS idx_user_interactions_user_id ON user_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_listing_id ON user_interactions(listing_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_type ON user_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_user_interactions_created_at ON user_interactions(created_at);

-- Subscription indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan);

-- Promotion indexes
CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code);
CREATE INDEX IF NOT EXISTS idx_promotions_valid_from ON promotions(valid_from);
CREATE INDEX IF NOT EXISTS idx_promotions_valid_until ON promotions(valid_until);
CREATE INDEX IF NOT EXISTS idx_promotions_is_active ON promotions(is_active);

-- Admin action indexes
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target_type ON admin_actions(target_type);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target_id ON admin_actions(target_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions(created_at);

-- ================================
-- COMPOSITE INDEXES
-- ================================

-- Listing search composite indexes
CREATE INDEX IF NOT EXISTS idx_listings_status_featured ON listings(status, is_featured);
CREATE INDEX IF NOT EXISTS idx_listings_category_status ON listings(category_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_vendor_status ON listings(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_price_status ON listings(price, status);

-- Chat lookup composite indexes
CREATE INDEX IF NOT EXISTS idx_chats_listing_buyer ON chats(listing_id, buyer_id);
CREATE INDEX IF NOT EXISTS idx_chats_vendor_status ON chats(vendor_id, status);

-- Transaction lookup composite indexes
CREATE INDEX IF NOT EXISTS idx_transactions_listing_status ON transactions(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_buyer_status ON transactions(buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_vendor_status ON transactions(vendor_id, status);

-- ================================
-- FUNCTIONS AND TRIGGERS
-- ================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at columns
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_listings_updated_at BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_listing_embeddings_updated_at BEFORE UPDATE ON listing_embeddings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================
-- VIEWS FOR COMMON QUERIES
-- ================================

-- Active listings view with vendor info
CREATE OR REPLACE VIEW active_listings_with_vendor AS
SELECT 
    l.*,
    u.username as vendor_username,
    u.business_name,
    u.vendor_verified,
    u.avatar_url as vendor_avatar,
    c.name as category_name,
    COALESCE(r.avg_rating, 0) as average_rating,
    COALESCE(r.review_count, 0) as review_count
FROM listings l
JOIN users u ON l.vendor_id = u.id
JOIN categories c ON l.category_id = c.id
LEFT JOIN (
    SELECT 
        listing_id,
        AVG(rating::numeric) as avg_rating,
        COUNT(*) as review_count
    FROM reviews 
    GROUP BY listing_id
) r ON l.id = r.listing_id
WHERE l.status = 'ACTIVE';

-- User statistics view
CREATE OR REPLACE VIEW user_stats AS
SELECT 
    u.id,
    u.username,
    u.role,
    u.vendor_verified,
    COALESCE(l.listing_count, 0) as listing_count,
    COALESCE(l.active_listing_count, 0) as active_listing_count,
    COALESCE(t.transaction_count, 0) as transaction_count,
    COALESCE(r.avg_rating, 0) as average_rating,
    COALESCE(r.review_count, 0) as review_count,
    u.created_at,
    u.last_login
FROM users u
LEFT JOIN (
    SELECT 
        vendor_id,
        COUNT(*) as listing_count,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_listing_count
    FROM listings 
    GROUP BY vendor_id
) l ON u.id = l.vendor_id
LEFT JOIN (
    SELECT 
        vendor_id,
        COUNT(*) as transaction_count
    FROM transactions 
    GROUP BY vendor_id
) t ON u.id = t.vendor_id
LEFT JOIN (
    SELECT 
        reviewee_id,
        AVG(rating::numeric) as avg_rating,
        COUNT(*) as review_count
    FROM reviews 
    GROUP BY reviewee_id
) r ON u.id = r.reviewee_id;

-- ================================
-- CLEANUP FUNCTIONS
-- ================================

-- Function to clean up old notifications
CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM notifications 
    WHERE is_read = true 
    AND created_at < CURRENT_DATE - INTERVAL '30 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old user interactions
CREATE OR REPLACE FUNCTION cleanup_old_interactions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_interactions 
    WHERE created_at < CURRENT_DATE - INTERVAL '90 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ================================
-- INITIAL DATA SETUP
-- ================================

-- Insert default categories (if they don't exist)
INSERT INTO categories (id, name, description) VALUES 
('cat_electronics', 'Electronics', 'Phones, computers, gadgets and electronic devices'),
('cat_fashion', 'Fashion & Apparel', 'Clothing, shoes, accessories and fashion items'),
('cat_home', 'Home & Garden', 'Furniture, decor, appliances and home improvement'),
('cat_automotive', 'Automotive', 'Cars, motorcycles, parts and automotive accessories'),
('cat_sports', 'Sports & Recreation', 'Sports equipment, outdoor gear and recreational items'),
('cat_books', 'Books & Media', 'Books, movies, music and educational materials'),
('cat_health', 'Health & Beauty', 'Skincare, makeup, health products and wellness items'),
('cat_toys', 'Toys & Games', 'Children toys, board games and gaming equipment'),
('cat_collectibles', 'Collectibles & Art', 'Antiques, collectibles, artwork and vintage items'),
('cat_other', 'Other', 'Items that dont fit in other categories')
ON CONFLICT (id) DO NOTHING;

-- Create default super admin user (password: Admin123!)
-- Note: In production, this should be created through a secure process
INSERT INTO users (
    id, 
    email, 
    username, 
    password_hash, 
    first_name, 
    last_name, 
    role, 
    status, 
    is_verified,
    vendor_verified
) VALUES (
    'user_super_admin_001',
    'admin@void-marketplace.com',
    'superadmin',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/lewohygHNhHFXFpV6', -- Admin123!
    'Super',
    'Admin',
    'SUPER_ADMIN',
    'ACTIVE',
    true,
    true
) ON CONFLICT (email) DO NOTHING;

-- ================================
-- PERFORMANCE OPTIMIZATIONS
-- ================================

-- Analyze tables for better query planning
ANALYZE users;
ANALYZE listings;
ANALYZE categories;
ANALYZE transactions;
ANALYZE chats;
ANALYZE messages;
ANALYZE reviews;
ANALYZE notifications;
ANALYZE user_interactions;

-- Set up automatic VACUUM and ANALYZE
-- This should be configured at the PostgreSQL level in production

COMMIT;