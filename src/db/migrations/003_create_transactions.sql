-- Migration: Create transactions table
-- Tracks all balance changes for users

-- Create transaction type enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN
        CREATE TYPE transaction_type AS ENUM ('credit', 'debit');
    END IF;
END $$;

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type transaction_type NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    source VARCHAR(50) NOT NULL,  -- 'card_redemption', 'partner_payment', 'admin_adjustment'
    reference_id UUID,            -- card_id, payment_session_id, or null for admin adjustments
    balance_after INTEGER NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source);
CREATE INDEX IF NOT EXISTS idx_transactions_reference_id ON transactions(reference_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);

-- Composite index for user transaction history queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);
