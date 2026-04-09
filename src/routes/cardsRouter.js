const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const {
    generateCards,
    decodeToken,
    verifySignature,
    getCardsByBatch,
    disableCard,
    disableBatch,
    VALID_VALUES,
} = require('../modules/generateCards');
const { generateCardsPDF } = require('../modules/pdfExport');

/**
 * Logs an audit event to the database
 * @param {Object} params - Audit log parameters
 */
async function logAuditEvent({
    eventType,
    cardId = null,
    userId = null,
    ipAddress = null,
    userAgent = null,
    requestPayload = null,
    responseStatus,
    failureReason = null,
    metadata = null,
}) {
    try {
        await pool.query(
            `INSERT INTO audit_logs
             (event_type, card_id, user_id, ip_address, user_agent, request_payload, response_status, failure_reason, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                eventType,
                cardId,
                userId,
                ipAddress,
                userAgent,
                requestPayload ? JSON.stringify(requestPayload) : null,
                responseStatus,
                failureReason,
                metadata ? JSON.stringify(metadata) : null,
            ]
        );
    } catch (error) {
        console.error('Failed to log audit event:', error);
    }
}

/**
 * Extracts client IP from request
 */
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.socket?.remoteAddress ||
           null;
}

/**
 * POST /api/cards/generate
 * Generate a batch of QR cards
 *
 * Body: { quantity: number, value: 10|50|100|200, expiresInDays: number }
 */
router.post('/generate', async (req, res) => {
    try {
        const { quantity, value, expiresInDays } = req.body;

        if (!quantity || !value || !expiresInDays) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: quantity, value, expiresInDays',
            });
        }

        const result = await generateCards({
            quantity: parseInt(quantity, 10),
            value: parseInt(value, 10),
            expiresInDays: parseInt(expiresInDays, 10),
        });

        await logAuditEvent({
            eventType: 'CARDS_GENERATED',
            ipAddress: getClientIP(req),
            userAgent: req.headers['user-agent'],
            requestPayload: { quantity, value, expiresInDays },
            responseStatus: 'SUCCESS',
            metadata: { batchId: result.batchId, count: result.quantity },
        });

        res.json({
            success: true,
            batchId: result.batchId,
            quantity: result.quantity,
            value: result.value,
            expiresAt: result.expiresAt,
            cards: result.cards,
        });
    } catch (error) {
        await logAuditEvent({
            eventType: 'CARDS_GENERATED',
            ipAddress: getClientIP(req),
            userAgent: req.headers['user-agent'],
            requestPayload: req.body,
            responseStatus: 'FAILURE',
            failureReason: error.message,
        });

        res.status(400).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * POST /api/cards/redeem
 * Redeem a QR card and credit points to user account
 *
 * Body: { token: string }
 * Requires authenticated user (req.user.id)
 */
router.post('/redeem', async (req, res) => {
    const client = await pool.connect();
    const { token } = req.body;
    const userId = req.user?.id; // Assumes auth middleware sets req.user
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'];

    if (!token) {
        await logAuditEvent({
            eventType: 'CARD_REDEMPTION',
            userId,
            ipAddress,
            userAgent,
            requestPayload: { token: '[MISSING]' },
            responseStatus: 'FAILURE',
            failureReason: 'Missing token',
        });

        return res.status(400).json({
            success: false,
            error: 'Token is required',
        });
    }

    if (!userId) {
        await logAuditEvent({
            eventType: 'CARD_REDEMPTION',
            ipAddress,
            userAgent,
            requestPayload: { token: token.substring(0, 20) + '...' },
            responseStatus: 'FAILURE',
            failureReason: 'User not authenticated',
        });

        return res.status(401).json({
            success: false,
            error: 'Authentication required',
        });
    }

    try {
        // Decode the token
        const decoded = decodeToken(token);

        if (!decoded) {
            await logAuditEvent({
                eventType: 'CARD_REDEMPTION',
                userId,
                ipAddress,
                userAgent,
                requestPayload: { token: token.substring(0, 20) + '...' },
                responseStatus: 'FAILURE',
                failureReason: 'Invalid token format',
            });

            return res.status(400).json({
                success: false,
                error: 'Invalid token format',
            });
        }

        const { payload, signature } = decoded;

        // Verify HMAC signature
        if (!verifySignature(payload, signature)) {
            await logAuditEvent({
                eventType: 'CARD_REDEMPTION',
                userId,
                ipAddress,
                userAgent,
                requestPayload: { cardId: payload.cardId },
                responseStatus: 'FAILURE',
                failureReason: 'Invalid signature',
            });

            return res.status(400).json({
                success: false,
                error: 'Invalid or tampered token',
            });
        }

        // Begin transaction
        await client.query('BEGIN');

        // Lock and fetch the card
        const cardResult = await client.query(
            `SELECT id, value, status, expires_at
             FROM qr_cards
             WHERE token = $1
             FOR UPDATE`,
            [token]
        );

        if (cardResult.rows.length === 0) {
            await client.query('ROLLBACK');

            await logAuditEvent({
                eventType: 'CARD_REDEMPTION',
                cardId: payload.cardId,
                userId,
                ipAddress,
                userAgent,
                requestPayload: { cardId: payload.cardId },
                responseStatus: 'FAILURE',
                failureReason: 'Card not found',
            });

            return res.status(404).json({
                success: false,
                error: 'Card not found',
            });
        }

        const card = cardResult.rows[0];

        // Verify card status
        if (card.status !== 'available') {
            await client.query('ROLLBACK');

            await logAuditEvent({
                eventType: 'CARD_REDEMPTION',
                cardId: card.id,
                userId,
                ipAddress,
                userAgent,
                requestPayload: { cardId: payload.cardId },
                responseStatus: 'FAILURE',
                failureReason: `Card status: ${card.status}`,
            });

            return res.status(400).json({
                success: false,
                error: `Card cannot be redeemed (status: ${card.status})`,
            });
        }

        // Verify expiration
        if (new Date(card.expires_at) < new Date()) {
            // Update card status to expired
            await client.query(
                `UPDATE qr_cards SET status = 'expired' WHERE id = $1`,
                [card.id]
            );
            await client.query('COMMIT');

            await logAuditEvent({
                eventType: 'CARD_REDEMPTION',
                cardId: card.id,
                userId,
                ipAddress,
                userAgent,
                requestPayload: { cardId: payload.cardId },
                responseStatus: 'FAILURE',
                failureReason: 'Card expired',
            });

            return res.status(400).json({
                success: false,
                error: 'Card has expired',
            });
        }

        // Credit points to user account (atomic update)
        const userUpdate = await client.query(
            `UPDATE users
             SET points_balance = points_balance + $1
             WHERE id = $2
             RETURNING points_balance`,
            [card.value, userId]
        );

        if (userUpdate.rows.length === 0) {
            await client.query('ROLLBACK');

            await logAuditEvent({
                eventType: 'CARD_REDEMPTION',
                cardId: card.id,
                userId,
                ipAddress,
                userAgent,
                requestPayload: { cardId: payload.cardId },
                responseStatus: 'FAILURE',
                failureReason: 'User account not found',
            });

            return res.status(404).json({
                success: false,
                error: 'User account not found',
            });
        }

        const newBalance = userUpdate.rows[0].points_balance;

        // Mark card as used
        await client.query(
            `UPDATE qr_cards
             SET status = 'used', used_at = NOW(), used_by = $1
             WHERE id = $2`,
            [userId, card.id]
        );

        // Commit transaction
        await client.query('COMMIT');

        await logAuditEvent({
            eventType: 'CARD_REDEMPTION',
            cardId: card.id,
            userId,
            ipAddress,
            userAgent,
            requestPayload: { cardId: payload.cardId },
            responseStatus: 'SUCCESS',
            metadata: { pointsAdded: card.value, newBalance },
        });

        res.json({
            success: true,
            pointsAdded: card.value,
            newBalance,
        });
    } catch (error) {
        await client.query('ROLLBACK');

        await logAuditEvent({
            eventType: 'CARD_REDEMPTION',
            userId,
            ipAddress,
            userAgent,
            requestPayload: { token: token?.substring(0, 20) + '...' },
            responseStatus: 'FAILURE',
            failureReason: error.message,
        });

        console.error('Redemption error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/cards/batch/:batchId
 * Get all cards from a specific batch
 */
router.get('/batch/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;

        const cards = await getCardsByBatch(batchId);

        if (cards.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Batch not found',
            });
        }

        res.json({
            success: true,
            batchId,
            count: cards.length,
            cards,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/cards/batch/:batchId/pdf
 * Download PDF of all cards in a batch
 */
router.get('/batch/:batchId/pdf', async (req, res) => {
    try {
        const { batchId } = req.params;

        const cards = await getCardsByBatch(batchId);

        if (cards.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Batch not found',
            });
        }

        const pdfBuffer = await generateCardsPDF(cards);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="pointpay-cards-${batchId.substring(0, 8)}.pdf"`
        );
        res.setHeader('Content-Length', pdfBuffer.length);

        res.send(pdfBuffer);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * POST /api/cards/:cardId/disable
 * Disable a specific card
 */
router.post('/:cardId/disable', async (req, res) => {
    try {
        const { cardId } = req.params;

        const disabled = await disableCard(cardId);

        if (!disabled) {
            return res.status(404).json({
                success: false,
                error: 'Card not found or already used/disabled',
            });
        }

        await logAuditEvent({
            eventType: 'CARD_DISABLED',
            cardId,
            ipAddress: getClientIP(req),
            userAgent: req.headers['user-agent'],
            responseStatus: 'SUCCESS',
        });

        res.json({
            success: true,
            message: 'Card disabled successfully',
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * POST /api/cards/batch/:batchId/disable
 * Disable all cards in a batch
 */
router.post('/batch/:batchId/disable', async (req, res) => {
    try {
        const { batchId } = req.params;

        const disabledCount = await disableBatch(batchId);

        await logAuditEvent({
            eventType: 'BATCH_DISABLED',
            ipAddress: getClientIP(req),
            userAgent: req.headers['user-agent'],
            responseStatus: 'SUCCESS',
            metadata: { batchId, disabledCount },
        });

        res.json({
            success: true,
            message: `Disabled ${disabledCount} cards`,
            disabledCount,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/cards/validate-only
 * Validate a token without redeeming (for preview/verification)
 */
router.post('/validate-only', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({
            success: false,
            error: 'Token is required',
        });
    }

    try {
        const decoded = decodeToken(token);

        if (!decoded) {
            return res.status(400).json({
                success: false,
                valid: false,
                error: 'Invalid token format',
            });
        }

        const { payload, signature } = decoded;

        if (!verifySignature(payload, signature)) {
            return res.status(400).json({
                success: false,
                valid: false,
                error: 'Invalid or tampered token',
            });
        }

        // Look up card in database
        const cardResult = await pool.query(
            `SELECT id, value, status, expires_at FROM qr_cards WHERE token = $1`,
            [token]
        );

        if (cardResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                valid: false,
                error: 'Card not found',
            });
        }

        const card = cardResult.rows[0];
        const isExpired = new Date(card.expires_at) < new Date();

        res.json({
            success: true,
            valid: card.status === 'available' && !isExpired,
            cardId: card.id,
            value: card.value,
            status: isExpired && card.status === 'available' ? 'expired' : card.status,
            expiresAt: card.expires_at,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

module.exports = router;
