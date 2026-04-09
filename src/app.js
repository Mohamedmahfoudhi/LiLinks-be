require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Route imports
const authRouter = require('./routes/authRouter');
const userRouter = require('./routes/userRouter');
const cardsRouter = require('./routes/cardsRouter');
const partnerRouter = require('./routes/partnerRouter');
const adminRouter = require('./routes/adminRouter');

// Initialize Redis connection
const redis = require('./db/redis');
redis.connect().catch(err => {
    console.error('Failed to connect to Redis:', err);
});

const app = express();

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// General rate limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { success: false, error: 'Too many requests, please try again later' },
});

// Auth rate limiting (stricter for login/register)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 auth attempts per 15 minutes
    message: { success: false, error: 'Too many authentication attempts, please try again later' },
});

// Redemption rate limiting (very strict)
const redeemLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Limit each IP to 10 redemption attempts per minute
    message: { success: false, error: 'Too many redemption attempts, please try again later' },
});

// Partner API rate limiting
const partnerLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute for partners
    message: { success: false, error: 'Rate limit exceeded' },
});

// Apply rate limiters
app.use('/auth', authLimiter);
app.use('/cards/redeem', redeemLimiter);
app.use('/api/payment', partnerLimiter);
app.use(generalLimiter);

// Routes
app.use('/auth', authRouter);           // Auth: /auth/register, /auth/login, etc.
app.use('/user', userRouter);           // User: /user/profile, /user/transactions
app.use('/cards', cardsRouter);         // Cards: /cards/redeem, /cards/validate-only
app.use('/api/payment', partnerRouter); // Partner API: /api/payment/initiate, etc.
app.use('/admin', adminRouter);         // Admin: /admin/users, /admin/cards, etc.

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`PointPay API running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
