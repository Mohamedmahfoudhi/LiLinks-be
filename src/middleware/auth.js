const { verifyAccessToken } = require('../services/authService');
const { findById } = require('../services/userService');

/**
 * Middleware to verify user authentication via JWT
 * Sets req.user with user information if authenticated
 */
async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: 'Authorization header missing or invalid',
        });
    }

    const token = authHeader.substring(7);

    try {
        const decoded = verifyAccessToken(token);

        if (!decoded) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired token',
            });
        }

        // Fetch fresh user data from database
        const user = await findById(decoded.userId);

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'User not found',
            });
        }

        if (user.is_blocked) {
            return res.status(403).json({
                success: false,
                error: 'Account is blocked',
            });
        }

        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            phone: user.phone,
            balance: user.balance,
            isAdmin: user.is_admin,
        };

        next();
    } catch (error) {
        console.error('Authentication error:', error);
        return res.status(401).json({
            success: false,
            error: 'Authentication failed',
        });
    }
}

/**
 * Middleware to check if user has admin role
 * Must be used after authenticate middleware
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required',
        });
    }

    if (!req.user.isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Admin access required',
        });
    }

    next();
}

/**
 * Optional authentication - sets req.user if token is valid, but doesn't fail
 * Useful for endpoints that have different behavior for authenticated users
 */
async function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }

    const token = authHeader.substring(7);

    try {
        const decoded = verifyAccessToken(token);

        if (decoded) {
            const user = await findById(decoded.userId);
            if (user && !user.is_blocked) {
                req.user = {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    phone: user.phone,
                    balance: user.balance,
                    isAdmin: user.is_admin,
                };
            } else {
                req.user = null;
            }
        } else {
            req.user = null;
        }
    } catch {
        req.user = null;
    }

    next();
}

module.exports = {
    authenticate,
    requireAdmin,
    optionalAuth,
};
