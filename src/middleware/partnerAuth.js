const { validateRequest } = require('../services/partnerService');

/**
 * Middleware to authenticate partner API requests
 * Validates API key + HMAC signature
 * Sets req.partner with partner information if authenticated
 */
async function partnerAuthenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    const timestamp = req.headers['x-timestamp'];
    const signature = req.headers['x-signature'];

    // Check required headers
    if (!apiKey || !timestamp || !signature) {
        return res.status(401).json({
            success: false,
            error: 'Missing authentication headers (X-API-Key, X-Timestamp, X-Signature)',
        });
    }

    try {
        // Get client IP (handle proxy scenarios)
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

        // Get original request body as string for signature validation
        const bodyString = req.rawBody || JSON.stringify(req.body) || '';

        const result = await validateRequest({
            apiKey,
            timestamp,
            signature,
            method: req.method,
            path: req.originalUrl.split('?')[0], // Path without query string
            body: bodyString,
            ip,
        });

        if (!result.valid) {
            return res.status(401).json({
                success: false,
                error: result.error,
            });
        }

        // Set partner info on request
        req.partner = {
            id: result.partner.id,
            name: result.partner.name,
            maxPerTransaction: result.partner.max_per_transaction,
        };

        next();
    } catch (error) {
        console.error('Partner authentication error:', error);
        return res.status(500).json({
            success: false,
            error: 'Authentication failed',
        });
    }
}

/**
 * Middleware to capture raw request body for signature verification
 * Must be used before body parsers
 */
function captureRawBody(req, res, next) {
    let data = '';

    req.on('data', chunk => {
        data += chunk;
    });

    req.on('end', () => {
        req.rawBody = data;
        next();
    });
}

/**
 * Middleware to check transaction amount against partner limit
 */
function checkTransactionLimit(req, res, next) {
    if (!req.partner) {
        return res.status(401).json({
            success: false,
            error: 'Partner authentication required',
        });
    }

    const amount = req.body.amount;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid amount',
        });
    }

    if (amount > req.partner.maxPerTransaction) {
        return res.status(400).json({
            success: false,
            error: `Amount exceeds maximum per transaction limit (${req.partner.maxPerTransaction})`,
        });
    }

    next();
}

module.exports = {
    partnerAuthenticate,
    captureRawBody,
    checkTransactionLimit,
};
