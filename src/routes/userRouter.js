const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validate');
const { findById, getBalance } = require('../services/userService');
const {
    getUserTransactions,
    getUserTransactionsSummary,
} = require('../services/transactionService');

// All routes require authentication
router.use(authenticate);

/**
 * GET /user/profile
 * Get current user's profile with balance
 */
router.get('/profile', async (req, res) => {
    try {
        const user = await findById(req.user.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
            });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                balance: user.balance,
                isAdmin: user.is_admin,
                createdAt: user.created_at,
            },
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get profile',
        });
    }
});

/**
 * GET /user/balance
 * Get current user's balance only
 */
router.get('/balance', async (req, res) => {
    try {
        const balance = await getBalance(req.user.id);

        res.json({
            success: true,
            balance,
        });
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get balance',
        });
    }
});

/**
 * GET /user/transactions
 * Get user's transaction history with pagination
 *
 * Query params:
 * - page: Page number (default 1)
 * - limit: Items per page (default 20, max 100)
 * - type: Filter by 'credit' or 'debit'
 * - source: Filter by source (card_redemption, partner_payment, admin_adjustment)
 */
router.get('/transactions', validatePagination, async (req, res) => {
    try {
        const { page, limit } = req.pagination;
        const { type, source } = req.query;

        const result = await getUserTransactions(req.user.id, {
            page,
            limit,
            type: type || null,
            source: source || null,
        });

        res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get transactions',
        });
    }
});

/**
 * GET /user/transactions/summary
 * Get summary statistics of user's transactions
 */
router.get('/transactions/summary', async (req, res) => {
    try {
        const summary = await getUserTransactionsSummary(req.user.id);

        res.json({
            success: true,
            summary,
        });
    } catch (error) {
        console.error('Get transactions summary error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get transactions summary',
        });
    }
});

module.exports = router;
