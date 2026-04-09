const redis = require('../db/redis');

const OTP_TTL = parseInt(process.env.OTP_TTL_SECONDS, 10) || 300;
const MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 3;

/**
 * Generate a random OTP code
 * @param {number} length - Length of OTP (default 6)
 * @returns {string} OTP code
 */
function generateOTPCode(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
        otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
}

/**
 * Get Redis key for OTP storage
 * @param {string} identifier - Phone number or email
 * @param {string} purpose - Purpose of OTP (registration, login, payment)
 * @returns {string} Redis key
 */
function getOTPKey(identifier, purpose = 'default') {
    return `otp:${purpose}:${identifier}`;
}

/**
 * Store OTP in Redis
 * @param {string} identifier - Phone number or email
 * @param {string} purpose - Purpose of OTP
 * @returns {Promise<string>} Generated OTP code
 */
async function createOTP(identifier, purpose = 'registration') {
    const code = generateOTPCode();
    const key = getOTPKey(identifier, purpose);

    const otpData = {
        code,
        attempts: 0,
        createdAt: Date.now(),
    };

    await redis.setex(key, OTP_TTL, JSON.stringify(otpData));

    // In production, send OTP via SMS/email
    // For development, log it
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[DEV] OTP for ${identifier}: ${code}`);
    }

    return code;
}

/**
 * Verify OTP code
 * @param {string} identifier - Phone number or email
 * @param {string} code - OTP code to verify
 * @param {string} purpose - Purpose of OTP
 * @returns {Promise<Object>} { valid, error }
 */
async function verifyOTP(identifier, code, purpose = 'registration') {
    const key = getOTPKey(identifier, purpose);

    const data = await redis.get(key);

    if (!data) {
        return { valid: false, error: 'OTP expired or not found' };
    }

    const otpData = JSON.parse(data);

    // Check max attempts
    if (otpData.attempts >= MAX_ATTEMPTS) {
        await redis.del(key);
        return { valid: false, error: 'Maximum attempts exceeded' };
    }

    // Check code
    if (otpData.code !== code) {
        // Increment attempts
        otpData.attempts += 1;
        const ttl = await redis.ttl(key);
        if (ttl > 0) {
            await redis.setex(key, ttl, JSON.stringify(otpData));
        }
        return {
            valid: false,
            error: 'Invalid OTP code',
            attemptsRemaining: MAX_ATTEMPTS - otpData.attempts,
        };
    }

    // Valid OTP - delete it
    await redis.del(key);

    return { valid: true };
}

/**
 * Check if OTP exists for identifier
 * @param {string} identifier - Phone number or email
 * @param {string} purpose - Purpose of OTP
 * @returns {Promise<boolean>}
 */
async function hasActiveOTP(identifier, purpose = 'registration') {
    const key = getOTPKey(identifier, purpose);
    const exists = await redis.exists(key);
    return exists === 1;
}

/**
 * Delete OTP (e.g., when user cancels registration)
 * @param {string} identifier - Phone number or email
 * @param {string} purpose - Purpose of OTP
 * @returns {Promise<void>}
 */
async function deleteOTP(identifier, purpose = 'registration') {
    const key = getOTPKey(identifier, purpose);
    await redis.del(key);
}

/**
 * Get remaining TTL for OTP
 * @param {string} identifier - Phone number or email
 * @param {string} purpose - Purpose of OTP
 * @returns {Promise<number>} TTL in seconds, -1 if expired, -2 if not exists
 */
async function getOTPTTL(identifier, purpose = 'registration') {
    const key = getOTPKey(identifier, purpose);
    return redis.ttl(key);
}

module.exports = {
    generateOTPCode,
    createOTP,
    verifyOTP,
    hasActiveOTP,
    deleteOTP,
    getOTPTTL,
};
