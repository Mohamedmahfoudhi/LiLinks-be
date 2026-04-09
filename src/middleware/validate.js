/**
 * Input validation middleware factory
 * Creates middleware that validates request body against a schema
 */

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean}
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return typeof email === 'string' && emailRegex.test(email);
}

/**
 * Validate phone format (E.164 or common formats)
 * @param {string} phone - Phone to validate
 * @returns {boolean}
 */
function isValidPhone(phone) {
    // Accept E.164 format and common variations
    const phoneRegex = /^\+?[1-9]\d{6,14}$/;
    return typeof phone === 'string' && phoneRegex.test(phone.replace(/[\s\-()]/g, ''));
}

/**
 * Validate UUID format
 * @param {string} uuid - UUID to validate
 * @returns {boolean}
 */
function isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return typeof uuid === 'string' && uuidRegex.test(uuid);
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} { valid, errors }
 */
function validatePassword(password) {
    const errors = [];

    if (typeof password !== 'string') {
        return { valid: false, errors: ['Password must be a string'] };
    }

    if (password.length < 8) {
        errors.push('Password must be at least 8 characters');
    }

    if (password.length > 128) {
        errors.push('Password must be at most 128 characters');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Create validation middleware for registration
 */
function validateRegistration(req, res, next) {
    const { name, email, phone, password } = req.body;
    const errors = [];

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
        errors.push('Name must be at least 2 characters');
    }

    if (!email || !isValidEmail(email)) {
        errors.push('Valid email is required');
    }

    if (!phone || !isValidPhone(phone)) {
        errors.push('Valid phone number is required');
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
        errors.push(...passwordValidation.errors);
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors,
        });
    }

    // Normalize data
    req.body.name = name.trim();
    req.body.email = email.toLowerCase().trim();
    req.body.phone = phone.replace(/[\s\-()]/g, '');

    next();
}

/**
 * Create validation middleware for login
 */
function validateLogin(req, res, next) {
    const { email, password } = req.body;
    const errors = [];

    if (!email || !isValidEmail(email)) {
        errors.push('Valid email is required');
    }

    if (!password || typeof password !== 'string') {
        errors.push('Password is required');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors,
        });
    }

    req.body.email = email.toLowerCase().trim();

    next();
}

/**
 * Create validation middleware for OTP verification
 */
function validateOTP(req, res, next) {
    const { phone, code } = req.body;
    const errors = [];

    if (!phone || !isValidPhone(phone)) {
        errors.push('Valid phone number is required');
    }

    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        errors.push('Valid 6-digit OTP code is required');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors,
        });
    }

    req.body.phone = phone.replace(/[\s\-()]/g, '');

    next();
}

/**
 * Create validation middleware for payment initiation
 */
function validatePaymentInitiate(req, res, next) {
    const { userId, amount } = req.body;
    const errors = [];

    if (!userId || !isValidUUID(userId)) {
        errors.push('Valid user ID is required');
    }

    if (!amount || typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
        errors.push('Amount must be a positive integer');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors,
        });
    }

    next();
}

/**
 * Create validation middleware for payment confirmation
 */
function validatePaymentConfirm(req, res, next) {
    const { sessionId, code } = req.body;
    const errors = [];

    if (!sessionId || !isValidUUID(sessionId)) {
        errors.push('Valid session ID is required');
    }

    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        errors.push('Valid 6-digit OTP code is required');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors,
        });
    }

    next();
}

/**
 * Create validation middleware for balance adjustment
 */
function validateBalanceAdjustment(req, res, next) {
    const { amount, reason } = req.body;
    const errors = [];

    if (amount === undefined || typeof amount !== 'number' || !Number.isInteger(amount) || amount === 0) {
        errors.push('Amount must be a non-zero integer');
    }

    if (reason && typeof reason !== 'string') {
        errors.push('Reason must be a string');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors,
        });
    }

    next();
}

/**
 * Validate pagination query parameters
 */
function validatePagination(req, res, next) {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    if (page < 1) {
        return res.status(400).json({
            success: false,
            error: 'Page must be at least 1',
        });
    }

    if (limit < 1 || limit > 100) {
        return res.status(400).json({
            success: false,
            error: 'Limit must be between 1 and 100',
        });
    }

    req.pagination = { page, limit };

    next();
}

/**
 * Validate refresh token request
 */
function validateRefreshToken(req, res, next) {
    const { refreshToken } = req.body;

    if (!refreshToken || typeof refreshToken !== 'string') {
        return res.status(400).json({
            success: false,
            error: 'Refresh token is required',
        });
    }

    next();
}

module.exports = {
    isValidEmail,
    isValidPhone,
    isValidUUID,
    validatePassword,
    validateRegistration,
    validateLogin,
    validateOTP,
    validatePaymentInitiate,
    validatePaymentConfirm,
    validateBalanceAdjustment,
    validatePagination,
    validateRefreshToken,
};
