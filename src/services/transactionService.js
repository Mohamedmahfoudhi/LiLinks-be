const pool = require('../db/pool');

/**
 * Create a transaction record
 * @param {Object} data - Transaction data
 * @param {string} data.userId - User ID
 * @param {string} data.type - 'credit' or 'debit'
 * @param {number} data.amount - Transaction amount
 * @param {string} data.source - Source of transaction
 * @param {string} data.referenceId - Reference ID (optional)
 * @param {number} data.balanceAfter - Balance after transaction
 * @param {string} data.description - Description (optional)
 * @param {Object} client - Optional database client for transactions
 * @returns {Promise<Object>} Created transaction
 */
async function createTransaction({ userId, type, amount, source, referenceId, balanceAfter, description }, client = null) {
    const db = client || pool;

    const result = await db.query(
        `INSERT INTO transactions (user_id, type, amount, source, reference_id, balance_after, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [userId, type, amount, source, referenceId || null, balanceAfter, description || null]
    );

    return result.rows[0];
}

/**
 * Get user transaction history
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (1-indexed)
 * @param {number} options.limit - Items per page
 * @param {string} options.type - Filter by type ('credit' or 'debit')
 * @param {string} options.source - Filter by source
 * @param {Date} options.startDate - Filter by start date
 * @param {Date} options.endDate - Filter by end date
 * @returns {Promise<Object>} { transactions, total, page, totalPages }
 */
async function getUserTransactions(userId, { page = 1, limit = 20, type = null, source = null, startDate = null, endDate = null } = {}) {
    const offset = (page - 1) * limit;
    const conditions = ['user_id = $1'];
    const params = [userId];
    let paramIndex = 2;

    if (type) {
        conditions.push(`type = $${paramIndex}`);
        params.push(type);
        paramIndex++;
    }

    if (source) {
        conditions.push(`source = $${paramIndex}`);
        params.push(source);
        paramIndex++;
    }

    if (startDate) {
        conditions.push(`created_at >= $${paramIndex}`);
        params.push(startDate);
        paramIndex++;
    }

    if (endDate) {
        conditions.push(`created_at <= $${paramIndex}`);
        params.push(endDate);
        paramIndex++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Get total count
    const countResult = await pool.query(
        `SELECT COUNT(*) FROM transactions ${whereClause}`,
        params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Get transactions
    const transactionsResult = await pool.query(
        `SELECT id, type, amount, source, reference_id, balance_after, description, created_at
         FROM transactions ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset]
    );

    return {
        transactions: transactionsResult.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit),
    };
}

/**
 * Get transaction by ID
 * @param {string} transactionId - Transaction ID
 * @returns {Promise<Object|null>} Transaction or null
 */
async function getTransactionById(transactionId) {
    const result = await pool.query(
        `SELECT t.*, u.name as user_name, u.email as user_email
         FROM transactions t
         JOIN users u ON t.user_id = u.id
         WHERE t.id = $1`,
        [transactionId]
    );
    return result.rows[0] || null;
}

/**
 * Get transactions summary for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Summary statistics
 */
async function getUserTransactionsSummary(userId) {
    const result = await pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE type = 'credit') as total_credits,
            COUNT(*) FILTER (WHERE type = 'debit') as total_debits,
            COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) as total_credited,
            COALESCE(SUM(amount) FILTER (WHERE type = 'debit'), 0) as total_debited
         FROM transactions
         WHERE user_id = $1`,
        [userId]
    );

    const stats = result.rows[0];
    return {
        totalCredits: parseInt(stats.total_credits, 10),
        totalDebits: parseInt(stats.total_debits, 10),
        totalCredited: parseInt(stats.total_credited, 10),
        totalDebited: parseInt(stats.total_debited, 10),
    };
}

/**
 * Record a card redemption transaction
 * @param {string} userId - User ID
 * @param {number} amount - Points added
 * @param {string} cardId - Card ID
 * @param {number} newBalance - New balance after redemption
 * @param {Object} client - Database client for transaction
 * @returns {Promise<Object>} Created transaction
 */
async function recordCardRedemption(userId, amount, cardId, newBalance, client) {
    return createTransaction({
        userId,
        type: 'credit',
        amount,
        source: 'card_redemption',
        referenceId: cardId,
        balanceAfter: newBalance,
        description: `Redeemed QR card worth ${amount} points`,
    }, client);
}

/**
 * Record a partner payment transaction
 * @param {string} userId - User ID
 * @param {number} amount - Points deducted
 * @param {string} sessionId - Payment session ID
 * @param {number} newBalance - New balance after payment
 * @param {Object} client - Database client for transaction
 * @returns {Promise<Object>} Created transaction
 */
async function recordPartnerPayment(userId, amount, sessionId, newBalance, client) {
    return createTransaction({
        userId,
        type: 'debit',
        amount,
        source: 'partner_payment',
        referenceId: sessionId,
        balanceAfter: newBalance,
        description: `Payment to partner for ${amount} points`,
    }, client);
}

/**
 * Record an admin balance adjustment
 * @param {string} userId - User ID
 * @param {number} amount - Amount adjusted (positive for credit, negative for debit)
 * @param {number} newBalance - New balance after adjustment
 * @param {string} reason - Reason for adjustment
 * @returns {Promise<Object>} Created transaction
 */
async function recordAdminAdjustment(userId, amount, newBalance, reason) {
    return createTransaction({
        userId,
        type: amount > 0 ? 'credit' : 'debit',
        amount: Math.abs(amount),
        source: 'admin_adjustment',
        referenceId: null,
        balanceAfter: newBalance,
        description: reason || 'Admin balance adjustment',
    });
}

module.exports = {
    createTransaction,
    getUserTransactions,
    getTransactionById,
    getUserTransactionsSummary,
    recordCardRedemption,
    recordPartnerPayment,
    recordAdminAdjustment,
};
