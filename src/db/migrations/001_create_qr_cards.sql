-- Migration: Create QR Cards and Audit Logs tables
-- Run this migration against your PostgreSQL database

-- Create enum type for card status
CREATE TYPE card_status AS ENUM ('available', 'used', 'expired', 'disabled');

-- Create qr_cards table
CREATE TABLE qr_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT UNIQUE NOT NULL,
    value INTEGER NOT NULL CHECK (value IN (10, 50, 100, 200)),
    status card_status NOT NULL DEFAULT 'available',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    used_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    batch_id UUID,

    CONSTRAINT valid_used_state CHECK (
        (status = 'used' AND used_at IS NOT NULL AND used_by IS NOT NULL) OR
        (status != 'used' AND used_at IS NULL AND used_by IS NULL)
    )
);

-- Create indexes for common queries
CREATE INDEX idx_qr_cards_token ON qr_cards(token);
CREATE INDEX idx_qr_cards_status ON qr_cards(status);
CREATE INDEX idx_qr_cards_expires_at ON qr_cards(expires_at);
CREATE INDEX idx_qr_cards_batch_id ON qr_cards(batch_id);
CREATE INDEX idx_qr_cards_used_by ON qr_cards(used_by);

-- Create audit_logs table for tracking all validation attempts
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL,
    card_id UUID REFERENCES qr_cards(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    request_payload JSONB,
    response_status VARCHAR(20) NOT NULL,
    failure_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for audit_logs
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_card_id ON audit_logs(card_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_response_status ON audit_logs(response_status);

-- Function to automatically expire cards
CREATE OR REPLACE FUNCTION expire_outdated_cards()
RETURNS INTEGER AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE qr_cards
    SET status = 'expired'
    WHERE status = 'available'
      AND expires_at < NOW();

    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a scheduled job to run expiration (requires pg_cron extension)
-- SELECT cron.schedule('expire-cards', '0 * * * *', 'SELECT expire_outdated_cards()');

COMMENT ON TABLE qr_cards IS 'Stores QR code cards for the PointPay loyalty program';
COMMENT ON TABLE audit_logs IS 'Audit trail for all card validation attempts';
