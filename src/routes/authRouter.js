const express = require('express');
const router = express.Router();
const {
    generateTokens,
    verifyRefreshToken,
    generateAccessToken,
} = require('../services/authService');
const {
    createUser,
    findByEmail,
    findByPhone,
    verifyCredentials,
    emailExists,
    phoneExists,
} = require('../services/userService');
const { createOTP, verifyOTP, hasActiveOTP } = require('../services/otpService');
const {
    validateRegistration,
    validateLogin,
    validateOTP,
    validateRefreshToken,
} = require('../middleware/validate');

// Store pending registrations temporarily (in production, use Redis)
const pendingRegistrations = new Map();

/**
 * POST /auth/register
 * Start registration process - sends OTP to phone
 */
router.post('/register', validateRegistration, async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;

        // Check if email already exists
        if (await emailExists(email)) {
            return res.status(400).json({
                success: false,
                error: 'Email already registered',
            });
        }

        // Check if phone already exists
        if (await phoneExists(phone)) {
            return res.status(400).json({
                success: false,
                error: 'Phone number already registered',
            });
        }

        // Check if there's already an active OTP
        if (await hasActiveOTP(phone, 'registration')) {
            return res.status(400).json({
                success: false,
                error: 'OTP already sent. Please wait before requesting a new one.',
            });
        }

        // Store registration data temporarily
        pendingRegistrations.set(phone, {
            name,
            email,
            phone,
            password,
            createdAt: Date.now(),
        });

        // Clean up old pending registrations (older than 10 minutes)
        for (const [key, value] of pendingRegistrations.entries()) {
            if (Date.now() - value.createdAt > 10 * 60 * 1000) {
                pendingRegistrations.delete(key);
            }
        }

        // Generate and send OTP
        await createOTP(phone, 'registration');

        res.json({
            success: true,
            message: 'OTP sent to phone number',
            phone,
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Registration failed',
        });
    }
});

/**
 * POST /auth/verify-otp
 * Verify OTP and complete registration
 */
router.post('/verify-otp', validateOTP, async (req, res) => {
    try {
        const { phone, code } = req.body;

        // Verify OTP
        const otpResult = await verifyOTP(phone, code, 'registration');

        if (!otpResult.valid) {
            return res.status(400).json({
                success: false,
                error: otpResult.error,
                attemptsRemaining: otpResult.attemptsRemaining,
            });
        }

        // Get pending registration data
        const registrationData = pendingRegistrations.get(phone);

        if (!registrationData) {
            return res.status(400).json({
                success: false,
                error: 'Registration data expired. Please start registration again.',
            });
        }

        // Create user
        const user = await createUser(registrationData);

        // Clean up pending registration
        pendingRegistrations.delete(phone);

        // Generate tokens
        const tokens = generateTokens(user);

        res.status(201).json({
            success: true,
            message: 'Registration successful',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                balance: user.balance,
            },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        });
    } catch (error) {
        console.error('OTP verification error:', error);

        // Handle unique constraint violations
        if (error.code === '23505') {
            return res.status(400).json({
                success: false,
                error: 'Email or phone already registered',
            });
        }

        res.status(500).json({
            success: false,
            error: 'Verification failed',
        });
    }
});

/**
 * POST /auth/login
 * Login with email and password
 */
router.post('/login', validateLogin, async (req, res) => {
    try {
        const { email, password } = req.body;

        // Verify credentials
        const user = await verifyCredentials(email, password);

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password',
            });
        }

        // Check if user is blocked
        if (user.is_blocked) {
            return res.status(403).json({
                success: false,
                error: 'Account is blocked. Please contact support.',
            });
        }

        // Generate tokens
        const tokens = generateTokens(user);

        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                balance: user.balance,
                isAdmin: user.is_admin,
            },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed',
        });
    }
});

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', validateRefreshToken, async (req, res) => {
    try {
        const { refreshToken } = req.body;

        // Verify refresh token
        const decoded = verifyRefreshToken(refreshToken);

        if (!decoded) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired refresh token',
            });
        }

        // Get user from database
        const { findById } = require('../services/userService');
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

        // Generate new access token
        const accessToken = generateAccessToken(user);

        res.json({
            success: true,
            accessToken,
        });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            success: false,
            error: 'Token refresh failed',
        });
    }
});

/**
 * POST /auth/resend-otp
 * Resend OTP for registration
 */
router.post('/resend-otp', async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is required',
            });
        }

        // Check if there's pending registration
        const registrationData = pendingRegistrations.get(phone);

        if (!registrationData) {
            return res.status(400).json({
                success: false,
                error: 'No pending registration found. Please start registration again.',
            });
        }

        // Check if user already exists
        if (await phoneExists(phone)) {
            return res.status(400).json({
                success: false,
                error: 'Phone number already registered',
            });
        }

        // Generate and send new OTP
        await createOTP(phone, 'registration');

        res.json({
            success: true,
            message: 'OTP resent to phone number',
        });
    } catch (error) {
        console.error('Resend OTP error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to resend OTP',
        });
    }
});

module.exports = router;
