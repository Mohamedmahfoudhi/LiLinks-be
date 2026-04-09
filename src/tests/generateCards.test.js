const {
    signPayload,
    verifySignature,
    encodeToken,
    decodeToken,
    generateSingleCard,
    VALID_VALUES,
} = require('../modules/generateCards');

// Set test secret
process.env.QR_SECRET = 'test_secret_key_for_unit_tests';

describe('QR Card Generation Module', () => {
    describe('signPayload', () => {
        it('should generate consistent signatures for same payload', () => {
            const payload = { cardId: 'test-123', expiresAt: '2025-01-01' };
            const sig1 = signPayload(payload);
            const sig2 = signPayload(payload);
            expect(sig1).toBe(sig2);
        });

        it('should generate different signatures for different payloads', () => {
            const payload1 = { cardId: 'test-123', expiresAt: '2025-01-01' };
            const payload2 = { cardId: 'test-456', expiresAt: '2025-01-01' };
            const sig1 = signPayload(payload1);
            const sig2 = signPayload(payload2);
            expect(sig1).not.toBe(sig2);
        });

        it('should return hex-encoded 64 character string', () => {
            const payload = { cardId: 'test-123' };
            const signature = signPayload(payload);
            expect(signature).toMatch(/^[a-f0-9]{64}$/);
        });
    });

    describe('verifySignature', () => {
        it('should return true for valid signatures', () => {
            const payload = { cardId: 'test-123', expiresAt: '2025-01-01' };
            const signature = signPayload(payload);
            expect(verifySignature(payload, signature)).toBe(true);
        });

        it('should return false for invalid signatures', () => {
            const payload = { cardId: 'test-123', expiresAt: '2025-01-01' };
            const fakeSignature = 'a'.repeat(64);
            expect(verifySignature(payload, fakeSignature)).toBe(false);
        });

        it('should return false for tampered payloads', () => {
            const originalPayload = { cardId: 'test-123', expiresAt: '2025-01-01' };
            const signature = signPayload(originalPayload);
            const tamperedPayload = { cardId: 'test-123', expiresAt: '2030-01-01' };
            expect(verifySignature(tamperedPayload, signature)).toBe(false);
        });
    });

    describe('encodeToken / decodeToken', () => {
        it('should encode and decode tokens correctly', () => {
            const payload = { cardId: 'test-123', expiresAt: '2025-01-01' };
            const signature = signPayload(payload);
            const token = encodeToken(payload, signature);
            const decoded = decodeToken(token);

            expect(decoded).not.toBeNull();
            expect(decoded.payload).toEqual(payload);
            expect(decoded.signature).toBe(signature);
        });

        it('should return null for invalid tokens', () => {
            expect(decodeToken('invalid-token')).toBeNull();
            expect(decodeToken('')).toBeNull();
            expect(decodeToken('eyJ0ZXN0IjoxMjN9')).toBeNull(); // Valid base64 but missing structure
        });

        it('should produce URL-safe tokens', () => {
            const payload = { cardId: 'test-123', data: 'some+special/chars=' };
            const signature = signPayload(payload);
            const token = encodeToken(payload, signature);

            // Should not contain URL-unsafe characters
            expect(token).not.toMatch(/[+/=]/);
        });
    });

    describe('generateSingleCard', () => {
        it('should generate a card with all required fields', () => {
            const expiresAt = new Date('2025-12-31');
            const card = generateSingleCard(100, expiresAt);

            expect(card).toHaveProperty('cardId');
            expect(card).toHaveProperty('token');
            expect(card).toHaveProperty('value', 100);
            expect(card).toHaveProperty('expiresAt');
            expect(card).toHaveProperty('createdAt');
            expect(card).toHaveProperty('status', 'available');
        });

        it('should generate unique card IDs', () => {
            const expiresAt = new Date('2025-12-31');
            const card1 = generateSingleCard(100, expiresAt);
            const card2 = generateSingleCard(100, expiresAt);

            expect(card1.cardId).not.toBe(card2.cardId);
            expect(card1.token).not.toBe(card2.token);
        });

        it('should generate valid UUID format for cardId', () => {
            const expiresAt = new Date('2025-12-31');
            const card = generateSingleCard(50, expiresAt);
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

            expect(card.cardId).toMatch(uuidRegex);
        });

        it('should NOT include value in the token payload', () => {
            const expiresAt = new Date('2025-12-31');
            const card = generateSingleCard(200, expiresAt);
            const decoded = decodeToken(card.token);

            expect(decoded.payload).not.toHaveProperty('value');
        });
    });

    describe('VALID_VALUES', () => {
        it('should contain exactly [10, 50, 100, 200]', () => {
            expect(VALID_VALUES).toEqual([10, 50, 100, 200]);
        });
    });
});
