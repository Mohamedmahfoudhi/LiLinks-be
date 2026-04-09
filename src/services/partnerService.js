const crypto = require('crypto');
const pool = require('../db/pool');

/**
 * Find partner by API key
 * @param {string} apiKey - Partner API key
 * @returns {Promise<Object|null>} Partner object or null
 */
async function findByApiKey(apiKey) {
    const result = await pool.query(
        `SELECT id, name, api_key, api_secret, is_active, max_per_transaction, webhook_url, ip_whitelist, created_at
         FROM api_partners
         WHERE api_key = $1`,
        [apiKey]
    );
    return result.rows[0] || null;
}

/**
 * Find partner by ID
 * @param {string} partnerId - Partner ID
 * @returns {Promise<Object|null>} Partner object or null
 */
async function findById(partnerId) {
    const result = await pool.query(
        `SELECT id, name, api_key, api_secret, is_active, max_per_transaction, webhook_url, ip_whitelist, created_at
         FROM api_partners
         WHERE id = $1`,
        [partnerId]
    );
    return result.rows[0] || null;
}

/**
 * Generate HMAC signature for request validation
 * @param {string} secret - Partner API secret
 * @param {string} timestamp - Request timestamp
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {string} body - Request body (JSON string)
 * @returns {string} HMAC signature (hex)
 */
function generateSignature(secret, timestamp, method, path, body) {
    const payload = `${timestamp}${method.toUpperCase()}${path}${body || ''}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify HMAC signature
 * @param {string} secret - Partner API secret
 * @param {string} timestamp - Request timestamp
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {string} body - Request body (JSON string)
 * @param {string} signature - Provided signature
 * @returns {boolean} True if signature is valid
 */
function verifySignature(secret, timestamp, method, path, body, signature) {
    const expectedSignature = generateSignature(secret, timestamp, method, path, body);

    // Timing-safe comparison
    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    } catch (error) {
        return false;
    }
}

/**
 * Check if timestamp is within acceptable range (5 minutes)
 * @param {string} timestamp - Unix timestamp in seconds
 * @returns {boolean} True if timestamp is valid
 */
function isTimestampValid(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const ts = parseInt(timestamp, 10);
    const maxAge = 5 * 60; // 5 minutes

    return !isNaN(ts) && Math.abs(now - ts) <= maxAge;
}

/**
 * Validate partner request (API key + HMAC)
 * @param {Object} request - Request object
 * @param {string} request.apiKey - API key from X-API-Key header
 * @param {string} request.timestamp - Timestamp from X-Timestamp header
 * @param {string} request.signature - Signature from X-Signature header
 * @param {string} request.method - HTTP method
 * @param {string} request.path - Request path
 * @param {string} request.body - Request body
 * @param {string} request.ip - Client IP address
 * @returns {Promise<Object>} { valid, partner, error }
 */
async function validateRequest({ apiKey, timestamp, signature, method, path, body, ip }) {
    // Check timestamp freshness
    if (!isTimestampValid(timestamp)) {
        return { valid: false, error: 'Request timestamp expired or invalid' };
    }

    // Find partner
    const partner = await findByApiKey(apiKey);

    if (!partner) {
        return { valid: false, error: 'Invalid API key' };
    }

    if (!partner.is_active) {
        return { valid: false, error: 'Partner account is inactive' };
    }

    // Check IP whitelist
    if (partner.ip_whitelist && partner.ip_whitelist.length > 0) {
        if (!partner.ip_whitelist.includes(ip)) {
            return { valid: false, error: 'IP address not whitelisted' };
        }
    }

    // Verify signature
    if (!verifySignature(partner.api_secret, timestamp, method, path, body, signature)) {
        return { valid: false, error: 'Invalid signature' };
    }

    return { valid: true, partner };
}

/**
 * Create a new API partner
 * @param {Object} data - Partner data
 * @param {string} data.name - Partner name
 * @param {number} data.maxPerTransaction - Max points per transaction
 * @param {string} data.webhookUrl - Webhook URL (optional)
 * @param {string[]} data.ipWhitelist - IP whitelist (optional)
 * @returns {Promise<Object>} Created partner with credentials
 */
async function createPartner({ name, maxPerTransaction = 10000, webhookUrl = null, ipWhitelist = null }) {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiSecret = crypto.randomBytes(32).toString('hex');

    const result = await pool.query(
        `INSERT INTO api_partners (name, api_key, api_secret, max_per_transaction, webhook_url, ip_whitelist)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, api_key, api_secret, is_active, max_per_transaction, webhook_url, ip_whitelist, created_at`,
        [name, apiKey, apiSecret, maxPerTransaction, webhookUrl, ipWhitelist]
    );

    return result.rows[0];
}

/**
 * Deactivate a partner
 * @param {string} partnerId - Partner ID
 * @returns {Promise<Object>} Updated partner
 */
async function deactivatePartner(partnerId) {
    const result = await pool.query(
        `UPDATE api_partners
         SET is_active = false, updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, is_active`,
        [partnerId]
    );

    if (result.rows.length === 0) {
        throw new Error('Partner not found');
    }

    return result.rows[0];
}

/**
 * Regenerate partner API credentials
 * @param {string} partnerId - Partner ID
 * @returns {Promise<Object>} Partner with new credentials
 */
async function regenerateCredentials(partnerId) {
    const newApiKey = crypto.randomBytes(32).toString('hex');
    const newApiSecret = crypto.randomBytes(32).toString('hex');

    const result = await pool.query(
        `UPDATE api_partners
         SET api_key = $1, api_secret = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING id, name, api_key, api_secret, is_active, max_per_transaction`,
        [newApiKey, newApiSecret, partnerId]
    );

    if (result.rows.length === 0) {
        throw new Error('Partner not found');
    }

    return result.rows[0];
}

/**
 * List all partners
 * @param {Object} options - Query options
 * @param {boolean} options.activeOnly - Only return active partners
 * @returns {Promise<Object[]>} List of partners (without secrets)
 */
async function listPartners({ activeOnly = false } = {}) {
    const whereClause = activeOnly ? 'WHERE is_active = true' : '';

    const result = await pool.query(
        `SELECT id, name, api_key, is_active, max_per_transaction, webhook_url, ip_whitelist, created_at
         FROM api_partners
         ${whereClause}
         ORDER BY created_at DESC`
    );

    return result.rows;
}

module.exports = {
    findByApiKey,
    findById,
    generateSignature,
    verifySignature,
    isTimestampValid,
    validateRequest,
    createPartner,
    deactivatePartner,
    regenerateCredentials,
    listPartners,
};
