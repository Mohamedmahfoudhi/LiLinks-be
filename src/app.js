require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cardsRouter = require('./routes/cardsRouter');

const app = express();

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// Rate limiting for card operations
const cardLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { success: false, error: 'Too many requests, please try again later' },
});

// Rate limiting specifically for redemptions (stricter)
const redeemLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Limit each IP to 10 redemption attempts per minute
    message: { success: false, error: 'Too many redemption attempts, please try again later' },
});

// Apply rate limiters
app.use('/api/cards', cardLimiter);
app.use('/api/cards/redeem', redeemLimiter);

// Routes
app.use('/api/cards', cardsRouter);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
    console.log(`PointPay QR Cards API running on port ${PORT}`);
});

module.exports = app;
