const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// Dimensions in points (1 point = 1/72 inch)
// A4 page: 210mm x 297mm = 595.28 x 841.89 points
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

// Card size: wider cards with proper height for content
const CARD_WIDTH = 250;
const CARD_HEIGHT = 200;

// Grid layout: 2 columns x 3 rows (fewer cards, better spacing)
const COLS = 2;
const ROWS = 3;
const CARDS_PER_PAGE = COLS * ROWS;

// Margins and spacing between cards
const CARD_GAP_X = 20;
const CARD_GAP_Y = 30;
const PAGE_MARGIN_X = (A4_WIDTH - COLS * CARD_WIDTH - (COLS - 1) * CARD_GAP_X) / 2;
const PAGE_MARGIN_Y = (A4_HEIGHT - ROWS * CARD_HEIGHT - (ROWS - 1) * CARD_GAP_Y) / 2;

// Card internal layout
const CARD_PADDING = 15;
const QR_SIZE = 70;

/**
 * Formats a date for display on the card
 * @param {Date|string} date - The date to format
 * @returns {string} - Formatted date string
 */
function formatExpiryDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

/**
 * Generates a QR code as a PNG buffer
 * @param {string} token - The data to encode
 * @returns {Promise<Buffer>} - PNG buffer
 */
async function generateQRBuffer(token) {
    return QRCode.toBuffer(token, {
        errorCorrectionLevel: 'M',
        type: 'png',
        width: QR_SIZE * 2, // Higher resolution for better print quality
        margin: 1,
    });
}

/**
 * Draws the PointPay logo (text-based for simplicity)
 * @param {PDFDocument} doc - The PDF document
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} width - Available width
 */
function drawLogo(doc, x, y, width) {
    doc.save();

    // Logo background accent
    doc.fillColor('#1a73e8')
        .roundedRect(x + width / 2 - 45, y, 90, 20, 4)
        .fill();

    // Logo text
    doc.fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text('PointPay', x, y + 4, {
            width,
            align: 'center',
        });

    doc.restore();
}

/**
 * Draws a single card on the PDF
 * @param {PDFDocument} doc - The PDF document
 * @param {Object} card - Card data
 * @param {number} x - X position of card
 * @param {number} y - Y position of card
 * @param {Buffer} qrBuffer - QR code PNG buffer
 */
function drawCard(doc, card, x, y, qrBuffer) {
    const shortId = card.cardId.substring(0, 8).toUpperCase();

    doc.save();

    // Card shadow effect
    doc.fillColor('#00000010')
        .roundedRect(x + 2, y + 2, CARD_WIDTH, CARD_HEIGHT, 10)
        .fill();

    // Card background with rounded corners
    doc.fillColor('#ffffff')
        .roundedRect(x, y, CARD_WIDTH, CARD_HEIGHT, 10)
        .fill();

    // Card border
    doc.strokeColor('#d0d0d0')
        .lineWidth(0.5)
        .roundedRect(x, y, CARD_WIDTH, CARD_HEIGHT, 10)
        .stroke();

    // Inner content area
    const contentX = x + CARD_PADDING;
    const contentY = y + CARD_PADDING;
    const contentWidth = CARD_WIDTH - 2 * CARD_PADDING;

    // Logo at top
    drawLogo(doc, contentX, contentY, contentWidth);

    // Points value - large and prominent
    doc.fillColor('#1a1a1a')
        .font('Helvetica-Bold')
        .fontSize(28)
        .text(`${card.value}`, contentX, contentY + 28, {
            width: contentWidth,
            align: 'center',
        });

    doc.fillColor('#666666')
        .font('Helvetica')
        .fontSize(10)
        .text('POINTS', contentX, contentY + 55, {
            width: contentWidth,
            align: 'center',
        });

    // QR Code - centered with more space
    const qrX = x + (CARD_WIDTH - QR_SIZE) / 2;
    const qrY = contentY + 72;
    doc.image(qrBuffer, qrX, qrY, { width: QR_SIZE, height: QR_SIZE });

    // Bottom section with ID and expiry
    const bottomY = y + CARD_HEIGHT - CARD_PADDING;

    // Short identifier
    doc.fillColor('#333333')
        .font('Courier-Bold')
        .fontSize(9)
        .text(shortId, contentX, bottomY - 22, {
            width: contentWidth,
            align: 'center',
        });

    // Expiry date
    doc.fillColor('#888888')
        .font('Helvetica')
        .fontSize(8)
        .text(`Expires: ${formatExpiryDate(card.expiresAt)}`, contentX, bottomY - 10, {
            width: contentWidth,
            align: 'center',
        });

    doc.restore();
}

/**
 * Generates a print-ready PDF with QR cards
 * @param {Array} cards - Array of card objects with cardId, token, value, expiresAt
 * @returns {Promise<Buffer>} - PDF buffer
 */
async function generateCardsPDF(cards) {
    if (!cards || cards.length === 0) {
        throw new Error('No cards provided for PDF generation');
    }

    // Pre-generate all QR codes
    const qrBuffers = await Promise.all(
        cards.map((card) => generateQRBuffer(card.token))
    );

    return new Promise((resolve, reject) => {
        const chunks = [];

        const doc = new PDFDocument({
            size: 'A4',
            margin: 0,
            info: {
                Title: 'PointPay QR Cards',
                Author: 'PointPay System',
                Subject: 'Printable QR Code Cards',
                CreationDate: new Date(),
            },
        });

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        let cardIndex = 0;
        const totalPages = Math.ceil(cards.length / CARDS_PER_PAGE);

        for (let page = 0; page < totalPages; page++) {
            if (page > 0) {
                doc.addPage();
            }

            // Light gray background for the page
            doc.rect(0, 0, A4_WIDTH, A4_HEIGHT).fill('#f5f5f5');

            // Draw cards in grid with gaps
            for (let row = 0; row < ROWS && cardIndex < cards.length; row++) {
                for (let col = 0; col < COLS && cardIndex < cards.length; col++) {
                    const x = PAGE_MARGIN_X + col * (CARD_WIDTH + CARD_GAP_X);
                    const y = PAGE_MARGIN_Y + row * (CARD_HEIGHT + CARD_GAP_Y);

                    drawCard(doc, cards[cardIndex], x, y, qrBuffers[cardIndex]);
                    cardIndex++;
                }
            }

            // Page number at bottom
            doc.fillColor('#999999')
                .font('Helvetica')
                .fontSize(8)
                .text(`Page ${page + 1} of ${totalPages}`, 0, A4_HEIGHT - 20, {
                    width: A4_WIDTH,
                    align: 'center',
                });
        }

        doc.end();
    });
}

/**
 * Generates PDF and returns as base64 string
 * @param {Array} cards - Array of card objects
 * @returns {Promise<string>} - Base64 encoded PDF
 */
async function generateCardsPDFBase64(cards) {
    const buffer = await generateCardsPDF(cards);
    return buffer.toString('base64');
}

module.exports = {
    generateCardsPDF,
    generateCardsPDFBase64,
    CARDS_PER_PAGE,
};
