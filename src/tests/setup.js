// Test setup file
// Set required environment variables for testing

process.env.QR_SECRET = 'test_secret_key_for_unit_tests';
process.env.NODE_ENV = 'test';

// Mock console.error to reduce noise in tests
const originalConsoleError = console.error;
console.error = (...args) => {
    // Filter out expected errors during testing
    if (args[0]?.includes?.('Failed to log audit event')) {
        return;
    }
    originalConsoleError.apply(console, args);
};
