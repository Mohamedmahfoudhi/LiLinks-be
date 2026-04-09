const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const {
    decodeToken,
    verifySignature,
} = require('../modules/generateCards');
const { authenticate } = require('../middleware/auth');
const { recordCardRedemption } = require('../services/transactionService');

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
 * POST /cards/redeem
 * Redeem a QR card and credit points to user account
 *
 * Body: { token: string }
 * Requires authentication
 */
router.post('/redeem', authenticate, async (req, res) => {
    const client = await pool.connect();
    const { token } = req.body;
    const userId = req.user.id;
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
        // Use 'balance' column (updated in migration 002)
        const userUpdate = await client.query(
            `UPDATE users
             SET balance = balance + $1, updated_at = NOW()
             WHERE id = $2
             RETURNING balance`,
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

        const newBalance = userUpdate.rows[0].balance;

        // Mark card as used
        await client.query(
            `UPDATE qr_cards
             SET status = 'used', used_at = NOW(), used_by = $1
             WHERE id = $2`,
            [userId, card.id]
        );

        // Record transaction
        await recordCardRedemption(userId, card.value, card.id, newBalance, client);

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
 * POST /cards/validate-only
 * Validate a token without redeeming (for preview/verification)
 * Public endpoint - no authentication required
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
