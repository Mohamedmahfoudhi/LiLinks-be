-- Migration: Create Users table (prerequisite for qr_cards)
-- This is a minimal users table for the points system
-- Your actual users table may have additional fields

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX idx_users_email ON users(email);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE users IS 'User accounts for the PointPay loyalty platform';
COMMENT ON COLUMN users.points_balance IS 'Current points balance (cannot be negative)';
