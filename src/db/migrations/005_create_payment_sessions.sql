-- Migration: Create payment sessions table
-- Tracks partner-initiated payment sessions

-- Create payment status enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE payment_status AS ENUM ('pending', 'confirmed', 'failed', 'expired');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS payment_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES api_partners(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount > 0),
    status payment_status NOT NULL DEFAULT 'pending',
    metadata JSONB,           -- Store partner-specific data
    failure_reason TEXT,      -- Reason for failure if applicable
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_payment_sessions_partner_id ON payment_sessions(partner_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_user_id ON payment_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_status ON payment_sessions(status);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_created_at ON payment_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_expires_at ON payment_sessions(expires_at);

-- Function to expire old payment sessions
CREATE OR REPLACE FUNCTION expire_pending_payment_sessions()
RETURNS INTEGER AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE payment_sessions
    SET status = 'expired',
        failure_reason = 'Session expired'
    WHERE status = 'pending' AND expires_at < NOW();

    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql;
