#!/usr/bin/env node
/**
 * Example script: Generate a batch of QR cards (Demo Mode - No Database Required)
 *
 * Usage:
 *   node examples/generate-batch.js --quantity 8 --value 100 --days 30
 *
 * This script demonstrates how to:
 * 1. Generate cards programmatically
 * 2. Export them as PDF
 * 3. Save the JSON data
 */

require('dotenv').config();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// Set demo secret if not configured
process.env.QR_SECRET = process.env.QR_SECRET || 'demo_secret_key_for_testing';

function getArg(args, flag, defaultValue) {
    const index = args.indexOf(flag);
    if (index !== -1 && args[index + 1]) {
        return args[index + 1];
    }
    return defaultValue;
}

/**
 * Generate cards in memory (no database required)
 */
async function generateCardsDemo({ quantity, value, expiresInDays }) {
    const batchId = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const cards = [];

    for (let i = 0; i < quantity; i++) {
        const cardId = uuidv4();
        const createdAt = new Date().toISOString();

        // Payload does NOT include value (security: value stored in DB only)
        const payload = {
            cardId,
            expiresAt: expiresAt.toISOString(),
            createdAt,
        };

        // Sign with HMAC-SHA256
        const hmac = crypto.createHmac('sha256', process.env.QR_SECRET);
        hmac.update(JSON.stringify(payload));
        const signature = hmac.digest('hex');

        // Encode to base64url token
        const tokenData = { p: payload, s: signature };
        const token = Buffer.from(JSON.stringify(tokenData)).toString('base64url');

        // Generate QR code data URL
        const qrCodeDataURL = await QRCode.toDataURL(token, {
            errorCorrectionLevel: 'M',
            type: 'image/png',
            width: 200,
            margin: 2,
        });

        cards.push({
            cardId,
            token,
            value,
            expiresAt: expiresAt.toISOString(),
            status: 'available',
            qrCodeDataURL,
        });
    }

    return { batchId, quantity, value, expiresAt: expiresAt.toISOString(), cards };
}

async function main() {
    const args = process.argv.slice(2);
    const quantity = parseInt(getArg(args, '--quantity', '8'), 10);
    const value = parseInt(getArg(args, '--value', '100'), 10);
    const expiresInDays = parseInt(getArg(args, '--days', '30'), 10);

    console.log('\n🎴 PointPay QR Card Generator (Demo Mode)\n');
    console.log(`Generating ${quantity} cards with ${value} points each...`);
    console.log(`Expiration: ${expiresInDays} days from now\n`);

    try {
        const result = await generateCardsDemo({ quantity, value, expiresInDays });

        console.log(`✅ Generated ${result.cards.length} cards`);
        console.log(`📦 Batch ID: ${result.batchId}`);
        console.log(`📅 Expires: ${result.expiresAt}\n`);

        // Create output directory
        const outputDir = path.join(__dirname, '../output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Save JSON data
        const jsonPath = path.join(outputDir, `batch-${result.batchId.substring(0, 8)}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
        console.log(`📄 JSON saved: ${jsonPath}`);

        // Generate and save PDF
        const { generateCardsPDF } = require('../src/modules/pdfExport');
        const pdfBuffer = await generateCardsPDF(result.cards);
        const pdfPath = path.join(outputDir, `cards-${result.batchId.substring(0, 8)}.pdf`);
        fs.writeFileSync(pdfPath, pdfBuffer);
        console.log(`📑 PDF saved: ${pdfPath}`);

        // Print card summary
        console.log('\n--- Card Summary ---');
        result.cards.forEach((card, index) => {
            console.log(`${index + 1}. ${card.cardId.substring(0, 8)}... | ${card.value} pts | Token: ${card.token.substring(0, 20)}...`);
        });

        console.log('\n✨ Done! Check the output/ folder for generated files.\n');
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
