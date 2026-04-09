const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const pool = require('../db/pool');

const VALID_VALUES = [10, 50, 100, 200];

/**
 * Creates an HMAC-SHA256 signature of the payload
 * @param {Object} payload - The data to sign
 * @returns {string} - Hex-encoded signature
 */
function signPayload(payload) {
    const secret = process.env.QR_SECRET;
    if (!secret) {
        throw new Error('QR_SECRET environment variable is not set');
    }

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
}

/**
 * Verifies the HMAC signature of a payload
 * @param {Object} payload - The payload to verify
 * @param {string} signature - The signature to check against
 * @returns {boolean} - True if signature is valid
 */
function verifySignature(payload, signature) {
    const expectedSignature = signPayload(payload);
    return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
    );
}

/**
 * Encodes payload and signature into a base64url token
 * @param {Object} payload - The card payload
 * @param {string} signature - The HMAC signature
 * @returns {string} - Base64url encoded token
 */
function encodeToken(payload, signature) {
    const tokenData = {
        p: payload,
        s: signature,
    };
    const jsonString = JSON.stringify(tokenData);
    return Buffer.from(jsonString).toString('base64url');
}

/**
 * Decodes a base64url token back to payload and signature
 * @param {string} token - The base64url encoded token
 * @returns {{ payload: Object, signature: string } | null}
 */
function decodeToken(token) {
    try {
        const jsonString = Buffer.from(token, 'base64url').toString('utf8');
        const tokenData = JSON.parse(jsonString);

        if (!tokenData.p || !tokenData.s) {
            return null;
        }

        return {
            payload: tokenData.p,
            signature: tokenData.s,
        };
    } catch {
        return null;
    }
}

/**
 * Generates a single QR card
 * @param {number} value - Points value (10, 50, 100, or 200)
 * @param {Date} expiresAt - Expiration date
 * @returns {Object} - Card data including token
 */
function generateSingleCard(value, expiresAt) {
    const cardId = uuidv4();
    const createdAt = new Date().toISOString();

    // Payload contains only identifier and timestamps - NOT the value
    // Value is stored in DB only for security
    const payload = {
        cardId,
        expiresAt: expiresAt.toISOString(),
        createdAt,
    };

    const signature = signPayload(payload);
    const token = encodeToken(payload, signature);

    return {
        cardId,
        token,
        value,
        expiresAt,
        createdAt: new Date(createdAt),
        status: 'available',
    };
}

/**
 * Generates a QR code data URL for a token
 * @param {string} token - The card token
 * @returns {Promise<string>} - Base64 data URL of QR code image
 */
async function generateQRCodeDataURL(token) {
    return QRCode.toDataURL(token, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 200,
        margin: 2,
    });
}

/**
 * Bulk generates QR cards and saves them to the database
 * @param {Object} options - Generation options
 * @param {number} options.quantity - Number of cards to generate (1-1000)
 * @param {number} options.value - Points value (10, 50, 100, or 200)
 * @param {number} options.expiresInDays - Days until expiration
 * @returns {Promise<Object>} - Generated cards and batch info
 */
async function generateCards({ quantity, value, expiresInDays }) {
    // Validate inputs
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
        throw new Error('Quantity must be an integer between 1 and 1000');
    }

    if (!VALID_VALUES.includes(value)) {
        throw new Error(`Value must be one of: ${VALID_VALUES.join(', ')}`);
    }

    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
        throw new Error('expiresInDays must be an integer between 1 and 365');
    }

    const batchId = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const cards = [];

    // Generate all cards in memory first
    for (let i = 0; i < quantity; i++) {
        const card = generateSingleCard(value, expiresAt);
        card.batchId = batchId;
        cards.push(card);
    }

    // Insert all cards in a single transaction
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const insertQuery = `
            INSERT INTO qr_cards (id, token, value, status, expires_at, created_at, batch_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        for (const card of cards) {
            await client.query(insertQuery, [
                card.cardId,
                card.token,
                card.value,
                card.status,
                card.expiresAt,
                card.createdAt,
                card.batchId,
            ]);
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to save cards to database: ${error.message}`);
    } finally {
        client.release();
    }

    // Generate QR code data URLs for each card
    const cardsWithQR = await Promise.all(
        cards.map(async (card) => ({
            cardId: card.cardId,
            token: card.token,
            value: card.value,
            expiresAt: card.expiresAt.toISOString(),
            status: card.status,
            qrCodeDataURL: await generateQRCodeDataURL(card.token),
        }))
    );

    return {
        batchId,
        quantity,
        value,
        expiresAt: expiresAt.toISOString(),
        cards: cardsWithQR,
    };
}

/**
 * Retrieves cards by batch ID
 * @param {string} batchId - The batch UUID
 * @returns {Promise<Array>} - Array of card records
 */
async function getCardsByBatch(batchId) {
    const result = await pool.query(
        `SELECT id, token, value, status, expires_at, created_at
         FROM qr_cards
         WHERE batch_id = $1
         ORDER BY created_at`,
        [batchId]
    );

    return Promise.all(
        result.rows.map(async (row) => ({
            cardId: row.id,
            token: row.token,
            value: row.value,
            expiresAt: row.expires_at.toISOString(),
            status: row.status,
            qrCodeDataURL: await generateQRCodeDataURL(row.token),
        }))
    );
}

/**
 * Disables a specific card
 * @param {string} cardId - The card UUID
 * @returns {Promise<boolean>} - True if card was disabled
 */
async function disableCard(cardId) {
    const result = await pool.query(
        `UPDATE qr_cards
         SET status = 'disabled'
         WHERE id = $1 AND status = 'available'
         RETURNING id`,
        [cardId]
    );

    return result.rowCount > 0;
}

/**
 * Disables all cards in a batch
 * @param {string} batchId - The batch UUID
 * @returns {Promise<number>} - Number of cards disabled
 */
async function disableBatch(batchId) {
    const result = await pool.query(
        `UPDATE qr_cards
         SET status = 'disabled'
         WHERE batch_id = $1 AND status = 'available'`,
        [batchId]
    );

    return result.rowCount;
}

module.exports = {
    generateCards,
    generateSingleCard,
    generateQRCodeDataURL,
    signPayload,
    verifySignature,
    encodeToken,
    decodeToken,
    getCardsByBatch,
    disableCard,
    disableBatch,
    VALID_VALUES,
};
