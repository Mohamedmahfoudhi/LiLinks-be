const Redis = require('ioredis');

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    lazyConnect: true,
});

redis.on('error', (err) => {
    console.error('Redis connection error:', err);
});

redis.on('connect', () => {
    console.log('Connected to Redis');
});

redis.on('ready', () => {
    console.log('Redis ready');
});

module.exports = redis;
