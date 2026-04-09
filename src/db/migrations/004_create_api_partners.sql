-- Migration: Create API partners table
-- Stores credentials for partner applications

CREATE TABLE IF NOT EXISTS api_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    api_secret VARCHAR(64) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    max_per_transaction INTEGER DEFAULT 10000,
    webhook_url TEXT,
    ip_whitelist TEXT[],  -- Array of allowed IP addresses (null = all allowed)
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for API key lookups (primary authentication)
CREATE INDEX IF NOT EXISTS idx_api_partners_api_key ON api_partners(api_key);

-- Index for active partners
CREATE INDEX IF NOT EXISTS idx_api_partners_is_active ON api_partners(is_active);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_api_partners_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_api_partners_updated_at ON api_partners;
CREATE TRIGGER trigger_api_partners_updated_at
    BEFORE UPDATE ON api_partners
    FOR EACH ROW
    EXECUTE FUNCTION update_api_partners_updated_at();
