-- Migration: Update users table for authentication
-- Adds phone, password_hash, is_blocked, is_admin fields
-- Renames points_balance to balance

-- Add new columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Rename points_balance to balance (if exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'points_balance'
    ) THEN
        ALTER TABLE users RENAME COLUMN points_balance TO balance;
    END IF;
END $$;

-- Add balance column if it doesn't exist (in case migration runs fresh)
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0);

-- Create index on phone for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- Create index on is_blocked for admin queries
CREATE INDEX IF NOT EXISTS idx_users_is_blocked ON users(is_blocked);

-- Create index on is_admin
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);
