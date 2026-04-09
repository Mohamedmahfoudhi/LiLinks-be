const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { partnerAuthenticate, checkTransactionLimit } = require('../middleware/partnerAuth');
const { validatePaymentInitiate, validatePaymentConfirm } = require('../middleware/validate');
const { findById: findUserById, getBalance } = require('../services/userService');
const { createOTP, verifyOTP } = require('../services/otpService');
const { recordPartnerPayment } = require('../services/transactionService');

// All routes require partner authentication
router.use(partnerAuthenticate);

/**
 * POST /api/payment/initiate
 * Initiate a payment - check balance and send OTP
 *
 * Body: { userId, amount, metadata? }
 */
router.post('/initiate', validatePaymentInitiate, checkTransactionLimit, async (req, res) => {
    try {
        const { userId, amount, metadata } = req.body;
        const partnerId = req.partner.id;

        // Find user
        const user = await findUserById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
            });
        }

        if (user.is_blocked) {
            return res.status(403).json({
                success: false,
                error: 'User account is blocked',
            });
        }

        // Check balance
        if (user.balance < amount) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient balance',
                currentBalance: user.balance,
                required: amount,
            });
        }

        // Create payment session
        const sessionResult = await pool.query(
            `INSERT INTO payment_sessions (partner_id, user_id, amount, status, metadata)
             VALUES ($1, $2, $3, 'pending', $4)
             RETURNING id, created_at, expires_at`,
            [partnerId, userId, amount, metadata ? JSON.stringify(metadata) : null]
        );

        const session = sessionResult.rows[0];

        // Send OTP to user's phone
        await createOTP(user.phone, `payment:${session.id}`);

        res.json({
            success: true,
            sessionId: session.id,
            amount,
            userId,
            userName: user.name,
            expiresAt: session.expires_at,
            message: 'OTP sent to user phone',
        });
    } catch (error) {
        console.error('Payment initiation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to initiate payment',
        });
    }
});

/**
 * POST /api/payment/confirm
 * Confirm payment with OTP - deduct points
 *
 * Body: { sessionId, code }
 */
router.post('/confirm', validatePaymentConfirm, async (req, res) => {
    const client = await pool.connect();

    try {
        const { sessionId, code } = req.body;
        const partnerId = req.partner.id;

        await client.query('BEGIN');

        // Get and lock payment session
        const sessionResult = await client.query(
            `SELECT ps.*, u.phone, u.balance
             FROM payment_sessions ps
             JOIN users u ON ps.user_id = u.id
             WHERE ps.id = $1 AND ps.partner_id = $2
             FOR UPDATE`,
            [sessionId, partnerId]
        );

        if (sessionResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Payment session not found',
            });
        }

        const session = sessionResult.rows[0];

        // Check session status
        if (session.status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: `Payment session is ${session.status}`,
            });
        }

        // Check expiration
        if (new Date(session.expires_at) < new Date()) {
            await client.query(
                `UPDATE payment_sessions SET status = 'expired', failure_reason = 'Session expired' WHERE id = $1`,
                [sessionId]
            );
            await client.query('COMMIT');
            return res.status(400).json({
                success: false,
                error: 'Payment session expired',
            });
        }

        // Verify OTP
        const otpResult = await verifyOTP(session.phone, code, `payment:${sessionId}`);

        if (!otpResult.valid) {
            // Don't rollback - just return error
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: otpResult.error,
                attemptsRemaining: otpResult.attemptsRemaining,
            });
        }

        // Check balance again (may have changed)
        if (session.balance < session.amount) {
            await client.query(
                `UPDATE payment_sessions SET status = 'failed', failure_reason = 'Insufficient balance' WHERE id = $1`,
                [sessionId]
            );
            await client.query('COMMIT');
            return res.status(400).json({
                success: false,
                error: 'Insufficient balance',
            });
        }

        // Deduct balance
        const userUpdate = await client.query(
            `UPDATE users
             SET balance = balance - $1, updated_at = NOW()
             WHERE id = $2
             RETURNING balance`,
            [session.amount, session.user_id]
        );

        const newBalance = userUpdate.rows[0].balance;

        // Record transaction
        await recordPartnerPayment(
            session.user_id,
            session.amount,
            sessionId,
            newBalance,
            client
        );

        // Update session status
        await client.query(
            `UPDATE payment_sessions
             SET status = 'confirmed', confirmed_at = NOW()
             WHERE id = $1`,
            [sessionId]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            sessionId,
            amount: session.amount,
            newBalance,
            confirmedAt: new Date().toISOString(),
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Payment confirmation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to confirm payment',
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/payment/status/:id
 * Get payment session status
 */
router.get('/status/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const partnerId = req.partner.id;

        const result = await pool.query(
            `SELECT id, user_id, amount, status, metadata, created_at, confirmed_at, expires_at
             FROM payment_sessions
             WHERE id = $1 AND partner_id = $2`,
            [id, partnerId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Payment session not found',
            });
        }

        const session = result.rows[0];

        res.json({
            success: true,
            session: {
                id: session.id,
                userId: session.user_id,
                amount: session.amount,
                status: session.status,
                metadata: session.metadata,
                createdAt: session.created_at,
                confirmedAt: session.confirmed_at,
                expiresAt: session.expires_at,
            },
        });
    } catch (error) {
        console.error('Get payment status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get payment status',
        });
    }
});

/**
 * GET /api/payment/user/:userId/balance
 * Get user's balance (for partners to check before initiating)
 */
router.get('/user/:userId/balance', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await findUserById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
            });
        }

        res.json({
            success: true,
            userId: user.id,
            balance: user.balance,
            isBlocked: user.is_blocked,
        });
    } catch (error) {
        console.error('Get user balance error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user balance',
        });
    }
});

module.exports = router;
