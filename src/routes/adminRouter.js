const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validatePagination, validateBalanceAdjustment, isValidUUID } = require('../middleware/validate');
const { listUsers, setBlockStatus, findById, updateBalance } = require('../services/userService');
const { recordAdminAdjustment } = require('../services/transactionService');
const {
    generateCards,
    getCardsByBatch,
    disableCard,
    disableBatch,
    VALID_VALUES,
} = require('../modules/generateCards');
const { generateCardsPDF } = require('../modules/pdfExport');
const { createPartner, listPartners, deactivatePartner, regenerateCredentials } = require('../services/partnerService');

// All routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// ==================== USER MANAGEMENT ====================

/**
 * GET /admin/users
 * List all users with pagination and filters
 *
 * Query params:
 * - page: Page number (default 1)
 * - limit: Items per page (default 20, max 100)
 * - search: Search by name/email/phone
 * - isBlocked: Filter by blocked status (true/false)
 */
router.get('/users', validatePagination, async (req, res) => {
    try {
        const { page, limit } = req.pagination;
        const { search, isBlocked } = req.query;

        const result = await listUsers({
            page,
            limit,
            search: search || null,
            isBlocked: isBlocked === 'true' ? true : isBlocked === 'false' ? false : null,
        });

        res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list users',
        });
    }
});

/**
 * GET /admin/users/:id
 * Get a specific user's details
 */
router.get('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidUUID(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user ID',
            });
        }

        const user = await findById(id);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
            });
        }

        res.json({
            success: true,
            user,
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user',
        });
    }
});

/**
 * PATCH /admin/users/:id/block
 * Block or unblock a user
 *
 * Body: { blocked: boolean }
 */
router.patch('/users/:id/block', async (req, res) => {
    try {
        const { id } = req.params;
        const { blocked } = req.body;

        if (!isValidUUID(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user ID',
            });
        }

        if (typeof blocked !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'blocked must be a boolean',
            });
        }

        // Prevent admin from blocking themselves
        if (id === req.user.id) {
            return res.status(400).json({
                success: false,
                error: 'Cannot block your own account',
            });
        }

        const user = await setBlockStatus(id, blocked);

        res.json({
            success: true,
            user,
            message: blocked ? 'User blocked successfully' : 'User unblocked successfully',
        });
    } catch (error) {
        if (error.message === 'User not found') {
            return res.status(404).json({
                success: false,
                error: 'User not found',
            });
        }

        console.error('Block user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update user',
        });
    }
});

/**
 * PATCH /admin/users/:id/balance
 * Manually adjust a user's balance
 *
 * Body: { amount: number, reason?: string }
 */
router.patch('/users/:id/balance', validateBalanceAdjustment, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, reason } = req.body;

        if (!isValidUUID(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user ID',
            });
        }

        // Check if user exists and get current balance
        const user = await findById(id);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
            });
        }

        // Check if deduction would result in negative balance
        if (amount < 0 && user.balance + amount < 0) {
            return res.status(400).json({
                success: false,
                error: 'Adjustment would result in negative balance',
                currentBalance: user.balance,
                requestedAdjustment: amount,
            });
        }

        // Update balance
        const updatedUser = await updateBalance(id, amount);

        // Record transaction
        await recordAdminAdjustment(
            id,
            amount,
            updatedUser.balance,
            reason || `Admin adjustment by ${req.user.email}`
        );

        res.json({
            success: true,
            user: updatedUser,
            adjustment: amount,
            message: `Balance ${amount > 0 ? 'credited' : 'debited'} by ${Math.abs(amount)} points`,
        });
    } catch (error) {
        console.error('Balance adjustment error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to adjust balance',
        });
    }
});

// ==================== CARD MANAGEMENT ====================

/**
 * POST /admin/cards/generate
 * Generate a batch of QR cards
 *
 * Body: { quantity: number, value: 10|50|100|200, expiresInDays: number }
 */
router.post('/cards/generate', async (req, res) => {
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

        // Log admin action
        await pool.query(
            `INSERT INTO audit_logs (event_type, user_id, response_status, metadata)
             VALUES ('ADMIN_CARDS_GENERATED', $1, 'SUCCESS', $2)`,
            [
                req.user.id,
                JSON.stringify({ batchId: result.batchId, quantity: result.quantity, value: result.value }),
            ]
        );

        res.json({
            success: true,
            batchId: result.batchId,
            quantity: result.quantity,
            value: result.value,
            expiresAt: result.expiresAt,
            cards: result.cards,
        });
    } catch (error) {
        console.error('Card generation error:', error);
        res.status(400).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /admin/cards
 * List cards with filters
 *
 * Query params:
 * - page, limit: Pagination
 * - status: Filter by status
 * - value: Filter by value
 * - batchId: Filter by batch
 */
router.get('/cards', validatePagination, async (req, res) => {
    try {
        const { page, limit } = req.pagination;
        const { status, value, batchId } = req.query;
        const offset = (page - 1) * limit;

        const conditions = [];
        const params = [];
        let paramIndex = 1;

        if (status) {
            conditions.push(`status = $${paramIndex}`);
            params.push(status);
            paramIndex++;
        }

        if (value) {
            conditions.push(`value = $${paramIndex}`);
            params.push(parseInt(value, 10));
            paramIndex++;
        }

        if (batchId) {
            conditions.push(`batch_id = $${paramIndex}`);
            params.push(batchId);
            paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Get total count
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM qr_cards ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0].count, 10);

        // Get cards
        const cardsResult = await pool.query(
            `SELECT id, value, status, expires_at, used_at, used_by, batch_id, created_at
             FROM qr_cards ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            [...params, limit, offset]
        );

        res.json({
            success: true,
            cards: cardsResult.rows,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error('List cards error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list cards',
        });
    }
});

/**
 * GET /admin/cards/batch/:batchId
 * Get all cards from a batch
 */
router.get('/cards/batch/:batchId', async (req, res) => {
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
        console.error('Get batch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get batch',
        });
    }
});

/**
 * GET /admin/cards/batch/:batchId/pdf
 * Download PDF of batch
 */
router.get('/cards/batch/:batchId/pdf', async (req, res) => {
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
        console.error('PDF generation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate PDF',
        });
    }
});

/**
 * POST /admin/cards/:cardId/disable
 * Disable a specific card
 */
router.post('/cards/:cardId/disable', async (req, res) => {
    try {
        const { cardId } = req.params;
        const disabled = await disableCard(cardId);

        if (!disabled) {
            return res.status(404).json({
                success: false,
                error: 'Card not found or already used/disabled',
            });
        }

        res.json({
            success: true,
            message: 'Card disabled successfully',
        });
    } catch (error) {
        console.error('Disable card error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disable card',
        });
    }
});

/**
 * POST /admin/cards/batch/:batchId/disable
 * Disable all cards in a batch
 */
router.post('/cards/batch/:batchId/disable', async (req, res) => {
    try {
        const { batchId } = req.params;
        const disabledCount = await disableBatch(batchId);

        res.json({
            success: true,
            message: `Disabled ${disabledCount} cards`,
            disabledCount,
        });
    } catch (error) {
        console.error('Disable batch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disable batch',
        });
    }
});

// ==================== PARTNER MANAGEMENT ====================

/**
 * POST /admin/partners
 * Create a new API partner
 *
 * Body: { name, maxPerTransaction?, webhookUrl?, ipWhitelist? }
 */
router.post('/partners', async (req, res) => {
    try {
        const { name, maxPerTransaction, webhookUrl, ipWhitelist } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Partner name is required (min 2 characters)',
            });
        }

        const partner = await createPartner({
            name: name.trim(),
            maxPerTransaction,
            webhookUrl,
            ipWhitelist,
        });

        res.status(201).json({
            success: true,
            partner,
            message: 'Partner created successfully. Save the API credentials securely.',
        });
    } catch (error) {
        console.error('Create partner error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create partner',
        });
    }
});

/**
 * GET /admin/partners
 * List all API partners
 */
router.get('/partners', async (req, res) => {
    try {
        const { activeOnly } = req.query;
        const partners = await listPartners({ activeOnly: activeOnly === 'true' });

        res.json({
            success: true,
            partners,
        });
    } catch (error) {
        console.error('List partners error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list partners',
        });
    }
});

/**
 * POST /admin/partners/:id/deactivate
 * Deactivate a partner
 */
router.post('/partners/:id/deactivate', async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidUUID(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid partner ID',
            });
        }

        const partner = await deactivatePartner(id);

        res.json({
            success: true,
            partner,
            message: 'Partner deactivated successfully',
        });
    } catch (error) {
        if (error.message === 'Partner not found') {
            return res.status(404).json({
                success: false,
                error: 'Partner not found',
            });
        }

        console.error('Deactivate partner error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to deactivate partner',
        });
    }
});

/**
 * POST /admin/partners/:id/regenerate-credentials
 * Regenerate partner API credentials
 */
router.post('/partners/:id/regenerate-credentials', async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidUUID(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid partner ID',
            });
        }

        const partner = await regenerateCredentials(id);

        res.json({
            success: true,
            partner,
            message: 'Credentials regenerated. Save the new API credentials securely.',
        });
    } catch (error) {
        if (error.message === 'Partner not found') {
            return res.status(404).json({
                success: false,
                error: 'Partner not found',
            });
        }

        console.error('Regenerate credentials error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to regenerate credentials',
        });
    }
});

// ==================== STATISTICS ====================

/**
 * GET /admin/stats
 * Get platform statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM users WHERE is_blocked = true) as blocked_users,
                (SELECT COALESCE(SUM(balance), 0) FROM users) as total_balance,
                (SELECT COUNT(*) FROM qr_cards) as total_cards,
                (SELECT COUNT(*) FROM qr_cards WHERE status = 'available') as available_cards,
                (SELECT COUNT(*) FROM qr_cards WHERE status = 'used') as used_cards,
                (SELECT COUNT(*) FROM transactions) as total_transactions,
                (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'credit') as total_credited,
                (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'debit') as total_debited,
                (SELECT COUNT(*) FROM api_partners WHERE is_active = true) as active_partners,
                (SELECT COUNT(*) FROM payment_sessions WHERE status = 'confirmed') as confirmed_payments
        `);

        res.json({
            success: true,
            stats: stats.rows[0],
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics',
        });
    }
});

module.exports = router;
