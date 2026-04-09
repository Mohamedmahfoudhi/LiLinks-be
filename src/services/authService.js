const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'default_access_secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'default_refresh_secret';
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

/**
 * Hash a password using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
async function hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Compare a password with a hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {Promise<boolean>} True if password matches
 */
async function comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
}

/**
 * Generate access token
 * @param {Object} user - User object with id, email, isAdmin
 * @returns {string} JWT access token
 */
function generateAccessToken(user) {
    const payload = {
        userId: user.id,
        email: user.email,
        isAdmin: user.is_admin || false,
    };

    return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

/**
 * Generate refresh token
 * @param {string} userId - User ID
 * @returns {Object} { token, tokenId }
 */
function generateRefreshToken(userId) {
    const tokenId = uuidv4();
    const payload = {
        userId,
        tokenId,
    };

    const token = jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
    return { token, tokenId };
}

/**
 * Generate both access and refresh tokens
 * @param {Object} user - User object
 * @returns {Object} { accessToken, refreshToken, tokenId }
 */
function generateTokens(user) {
    const accessToken = generateAccessToken(user);
    const { token: refreshToken, tokenId } = generateRefreshToken(user.id);

    return {
        accessToken,
        refreshToken,
        tokenId,
    };
}

/**
 * Verify access token
 * @param {string} token - JWT access token
 * @returns {Object|null} Decoded payload or null if invalid
 */
function verifyAccessToken(token) {
    try {
        return jwt.verify(token, ACCESS_SECRET);
    } catch (error) {
        return null;
    }
}

/**
 * Verify refresh token
 * @param {string} token - JWT refresh token
 * @returns {Object|null} Decoded payload or null if invalid
 */
function verifyRefreshToken(token) {
    try {
        return jwt.verify(token, REFRESH_SECRET);
    } catch (error) {
        return null;
    }
}

/**
 * Decode token without verification (for debugging)
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded payload or null
 */
function decodeToken(token) {
    try {
        return jwt.decode(token);
    } catch (error) {
        return null;
    }
}

module.exports = {
    hashPassword,
    comparePassword,
    generateAccessToken,
    generateRefreshToken,
    generateTokens,
    verifyAccessToken,
    verifyRefreshToken,
    decodeToken,
};
