const pool = require('../db/pool');
const { hashPassword, comparePassword } = require('./authService');

/**
 * Create a new user
 * @param {Object} userData - User data
 * @param {string} userData.name - User name
 * @param {string} userData.email - User email
 * @param {string} userData.phone - User phone number
 * @param {string} userData.password - Plain text password
 * @returns {Promise<Object>} Created user (without password_hash)
 */
async function createUser({ name, email, phone, password }) {
    const passwordHash = await hashPassword(password);

    const result = await pool.query(
        `INSERT INTO users (name, email, phone, password_hash, balance)
         VALUES ($1, $2, $3, $4, 0)
         RETURNING id, name, email, phone, balance, is_blocked, is_admin, created_at, updated_at`,
        [name, email, phone, passwordHash]
    );

    return result.rows[0];
}

/**
 * Find user by email
 * @param {string} email - User email
 * @returns {Promise<Object|null>} User object or null
 */
async function findByEmail(email) {
    const result = await pool.query(
        `SELECT id, name, email, phone, password_hash, balance, is_blocked, is_admin, created_at, updated_at
         FROM users WHERE email = $1`,
        [email]
    );
    return result.rows[0] || null;
}

/**
 * Find user by phone
 * @param {string} phone - User phone number
 * @returns {Promise<Object|null>} User object or null
 */
async function findByPhone(phone) {
    const result = await pool.query(
        `SELECT id, name, email, phone, password_hash, balance, is_blocked, is_admin, created_at, updated_at
         FROM users WHERE phone = $1`,
        [phone]
    );
    return result.rows[0] || null;
}

/**
 * Find user by ID
 * @param {string} id - User ID
 * @returns {Promise<Object|null>} User object or null
 */
async function findById(id) {
    const result = await pool.query(
        `SELECT id, name, email, phone, balance, is_blocked, is_admin, created_at, updated_at
         FROM users WHERE id = $1`,
        [id]
    );
    return result.rows[0] || null;
}

/**
 * Verify user credentials
 * @param {string} email - User email
 * @param {string} password - Plain text password
 * @returns {Promise<Object|null>} User object or null if invalid
 */
async function verifyCredentials(email, password) {
    const user = await findByEmail(email);

    if (!user || !user.password_hash) {
        return null;
    }

    const isValid = await comparePassword(password, user.password_hash);

    if (!isValid) {
        return null;
    }

    // Return user without password_hash
    const { password_hash, ...userWithoutPassword } = user;
    return userWithoutPassword;
}

/**
 * Update user balance
 * @param {string} userId - User ID
 * @param {number} amount - Amount to add (negative to subtract)
 * @param {Object} client - Optional database client for transactions
 * @returns {Promise<Object>} Updated user
 */
async function updateBalance(userId, amount, client = null) {
    const db = client || pool;

    const result = await db.query(
        `UPDATE users
         SET balance = balance + $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, email, phone, balance, is_blocked, is_admin, created_at, updated_at`,
        [amount, userId]
    );

    if (result.rows.length === 0) {
        throw new Error('User not found');
    }

    return result.rows[0];
}

/**
 * Get user balance
 * @param {string} userId - User ID
 * @returns {Promise<number>} User balance
 */
async function getBalance(userId) {
    const result = await pool.query(
        'SELECT balance FROM users WHERE id = $1',
        [userId]
    );

    if (result.rows.length === 0) {
        throw new Error('User not found');
    }

    return result.rows[0].balance;
}

/**
 * Block or unblock a user
 * @param {string} userId - User ID
 * @param {boolean} blocked - Block status
 * @returns {Promise<Object>} Updated user
 */
async function setBlockStatus(userId, blocked) {
    const result = await pool.query(
        `UPDATE users
         SET is_blocked = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, email, phone, balance, is_blocked, is_admin, created_at, updated_at`,
        [blocked, userId]
    );

    if (result.rows.length === 0) {
        throw new Error('User not found');
    }

    return result.rows[0];
}

/**
 * List users with pagination and filters
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (1-indexed)
 * @param {number} options.limit - Items per page
 * @param {string} options.search - Search term for name/email/phone
 * @param {boolean} options.isBlocked - Filter by blocked status
 * @returns {Promise<Object>} { users, total, page, totalPages }
 */
async function listUsers({ page = 1, limit = 20, search = null, isBlocked = null }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (search) {
        conditions.push(
            `(name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR phone ILIKE $${paramIndex})`
        );
        params.push(`%${search}%`);
        paramIndex++;
    }

    if (isBlocked !== null) {
        conditions.push(`is_blocked = $${paramIndex}`);
        params.push(isBlocked);
        paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await pool.query(
        `SELECT COUNT(*) FROM users ${whereClause}`,
        params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Get users
    const usersResult = await pool.query(
        `SELECT id, name, email, phone, balance, is_blocked, is_admin, created_at, updated_at
         FROM users ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset]
    );

    return {
        users: usersResult.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit),
    };
}

/**
 * Check if email is already registered
 * @param {string} email - Email to check
 * @returns {Promise<boolean>}
 */
async function emailExists(email) {
    const result = await pool.query(
        'SELECT 1 FROM users WHERE email = $1',
        [email]
    );
    return result.rows.length > 0;
}

/**
 * Check if phone is already registered
 * @param {string} phone - Phone to check
 * @returns {Promise<boolean>}
 */
async function phoneExists(phone) {
    const result = await pool.query(
        'SELECT 1 FROM users WHERE phone = $1',
        [phone]
    );
    return result.rows.length > 0;
}

module.exports = {
    createUser,
    findByEmail,
    findByPhone,
    findById,
    verifyCredentials,
    updateBalance,
    getBalance,
    setBlockStatus,
    listUsers,
    emailExists,
    phoneExists,
};
