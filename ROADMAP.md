# PointPay Backend Roadmap

## Overview
PointPay is a loyalty platform with QR card generation, user authentication, partner API integration, and admin management features.

**Project Status:** Phases 1-9 Complete

---

## Completed Phases

### Phase 1: Infrastructure Setup

- [x] Add Redis to Docker Compose (`docker-compose.yml`)
- [x] Add environment variables (`.env.example`)
- [x] Create Redis connection module (`src/db/redis.js`)
- [x] Add new dependencies (`package.json`)

**New Dependencies:**
```json
{
  "jsonwebtoken": "^9.0.2",
  "bcrypt": "^5.1.1",
  "ioredis": "^5.3.2"
}
```

---

### Phase 2: Database Migrations

- [x] Update users table (`src/db/migrations/002_update_users.sql`)
- [x] Create transactions table (`src/db/migrations/003_create_transactions.sql`)
- [x] Create api_partners table (`src/db/migrations/004_create_api_partners.sql`)
- [x] Create payment_sessions table (`src/db/migrations/005_create_payment_sessions.sql`)

**Database Schema:**
```
users
├── id (UUID, PK)
├── email (VARCHAR, unique)
├── phone (VARCHAR, unique)
├── name (VARCHAR)
├── password_hash (VARCHAR)
├── balance (INTEGER, default 0)
├── is_blocked (BOOLEAN, default false)
├── is_admin (BOOLEAN, default false)
├── created_at (TIMESTAMPTZ)
└── updated_at (TIMESTAMPTZ)

transactions
├── id (UUID, PK)
├── user_id (UUID, FK -> users)
├── type (ENUM: credit, debit)
├── amount (INTEGER)
├── source (VARCHAR: card_redemption, partner_payment, admin_adjustment)
├── reference_id (UUID, nullable)
├── balance_after (INTEGER)
├── description (TEXT)
└── created_at (TIMESTAMPTZ)

api_partners
├── id (UUID, PK)
├── name (VARCHAR)
├── api_key (VARCHAR, unique)
├── api_secret (VARCHAR)
├── is_active (BOOLEAN, default true)
├── max_per_transaction (INTEGER, default 10000)
├── webhook_url (TEXT)
├── ip_whitelist (TEXT[])
├── created_at (TIMESTAMPTZ)
└── updated_at (TIMESTAMPTZ)

payment_sessions
├── id (UUID, PK)
├── partner_id (UUID, FK -> api_partners)
├── user_id (UUID, FK -> users)
├── amount (INTEGER)
├── status (ENUM: pending, confirmed, failed, expired)
├── metadata (JSONB)
├── failure_reason (TEXT)
├── created_at (TIMESTAMPTZ)
├── confirmed_at (TIMESTAMPTZ)
└── expires_at (TIMESTAMPTZ)
```

---

### Phase 3: Core Services

- [x] Auth Service (`src/services/authService.js`)
- [x] OTP Service (`src/services/otpService.js`)
- [x] User Service (`src/services/userService.js`)
- [x] Transaction Service (`src/services/transactionService.js`)
- [x] Partner Service (`src/services/partnerService.js`)

---

### Phase 4: Middleware

- [x] JWT Authentication (`src/middleware/auth.js`)
- [x] Partner HMAC Auth (`src/middleware/partnerAuth.js`)
- [x] Input Validation (`src/middleware/validate.js`)

---

### Phase 5: Auth Endpoints

**File:** `src/routes/authRouter.js`

- [x] `POST /auth/register` - Start registration, send OTP
- [x] `POST /auth/verify-otp` - Verify OTP, create account
- [x] `POST /auth/login` - Login with email/password
- [x] `POST /auth/refresh` - Refresh access token
- [x] `POST /auth/resend-otp` - Resend registration OTP

**Example - Register:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "password": "securePassword123"
  }'
```

**Example - Login:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "securePassword123"
  }'
```

---

### Phase 6: User Endpoints

**File:** `src/routes/userRouter.js`

- [x] `GET /user/profile` - Get user profile with balance (JWT)
- [x] `GET /user/balance` - Get balance only (JWT)
- [x] `GET /user/transactions` - Paginated transaction history (JWT)
- [x] `GET /user/transactions/summary` - Transaction statistics (JWT)

**Example - Get Profile:**
```bash
curl http://localhost:3000/user/profile \
  -H "Authorization: Bearer <access_token>"
```

---

### Phase 7: Cards Endpoints

**File:** `src/routes/cardsRouter.js`

- [x] `POST /cards/redeem` - Redeem QR card, credit points (JWT)
- [x] `POST /cards/validate-only` - Validate token without redeeming (Public)

**Example - Redeem Card:**
```bash
curl -X POST http://localhost:3000/cards/redeem \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"token": "<qr_card_token>"}'
```

---

### Phase 8: Partner API

**File:** `src/routes/partnerRouter.js`

- [x] `POST /api/payment/initiate` - Check balance, send OTP to user (HMAC)
- [x] `POST /api/payment/confirm` - Verify OTP, deduct points (HMAC)
- [x] `GET /api/payment/status/:id` - Get payment session status (HMAC)
- [x] `GET /api/payment/user/:id/balance` - Check user balance (HMAC)

**Partner Authentication Headers:**
```
X-API-Key: <partner_api_key>
X-Timestamp: <unix_timestamp_seconds>
X-Signature: HMAC-SHA256(api_secret, timestamp + method + path + body)
```

**Example - Initiate Payment:**
```bash
TIMESTAMP=$(date +%s)
BODY='{"userId":"<user_uuid>","amount":100}'
SIGNATURE=$(echo -n "${TIMESTAMP}POST/api/payment/initiate${BODY}" | \
  openssl dgst -sha256 -hmac "<api_secret>" | cut -d' ' -f2)

curl -X POST http://localhost:3000/api/payment/initiate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <api_key>" \
  -H "X-Timestamp: $TIMESTAMP" \
  -H "X-Signature: $SIGNATURE" \
  -d "$BODY"
```

---

### Phase 9: Admin Endpoints

**File:** `src/routes/adminRouter.js`

**User Management:**
- [x] `GET /admin/users` - List users with search/filter
- [x] `GET /admin/users/:id` - Get user details
- [x] `PATCH /admin/users/:id/block` - Block/unblock user
- [x] `PATCH /admin/users/:id/balance` - Manual balance adjustment

**Card Management:**
- [x] `POST /admin/cards/generate` - Generate batch of QR cards
- [x] `GET /admin/cards` - List cards with filters
- [x] `GET /admin/cards/batch/:id` - Get batch details
- [x] `GET /admin/cards/batch/:id/pdf` - Download batch as PDF
- [x] `POST /admin/cards/:id/disable` - Disable single card
- [x] `POST /admin/cards/batch/:id/disable` - Disable entire batch

**Partner Management:**
- [x] `GET /admin/partners` - List all partners
- [x] `POST /admin/partners` - Create new partner
- [x] `POST /admin/partners/:id/deactivate` - Deactivate partner
- [x] `POST /admin/partners/:id/regenerate-credentials` - Regenerate API keys

**Statistics:**
- [x] `GET /admin/stats` - Platform-wide statistics

**Example - Generate Cards:**
```bash
curl -X POST http://localhost:3000/admin/cards/generate \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "quantity": 10,
    "value": 100,
    "expiresInDays": 90
  }'
```

---

## Future Enhancements

### Phase 10: Notifications
- [ ] SMS integration (Twilio/MessageBird) for OTP delivery
- [ ] Email notifications for transactions
- [ ] Push notifications for mobile apps

### Phase 11: Webhooks
- [ ] Partner webhook notifications for payment status
- [ ] Retry logic for failed webhook deliveries
- [ ] Webhook signature verification

### Phase 12: Advanced Features
- [ ] User referral system
- [ ] Points expiration policies
- [ ] Tiered loyalty levels
- [ ] Promotional campaigns

### Phase 13: Analytics & Reporting
- [ ] Transaction reports (daily/weekly/monthly)
- [ ] Partner usage analytics
- [ ] User engagement metrics
- [ ] Export functionality (CSV/PDF)

### Phase 14: Mobile App API
- [ ] Device registration for push notifications
- [ ] QR scanner integration endpoints
- [ ] Offline transaction queue

### Phase 15: Security Enhancements
- [ ] Two-factor authentication (2FA)
- [ ] Session management (logout all devices)
- [ ] Suspicious activity detection
- [ ] Rate limiting per user (not just IP)

---

## Getting Started

### Prerequisites
- Node.js >= 18
- Docker & Docker Compose
- PostgreSQL 15
- Redis 7

### Quick Start
```bash
# Clone and install
git clone <repo>
cd QR-card-generation
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your settings

# Start services
docker-compose up -d

# Run migrations (connect to postgres and run SQL files)
# Or use: psql -h localhost -U postgres -d pointpay -f src/db/migrations/002_update_users.sql

# Start development server
npm run dev
```

### Environment Variables
```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pointpay
DB_USER=postgres
DB_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT (generate with: openssl rand -hex 64)
JWT_ACCESS_SECRET=<random_secret>
JWT_REFRESH_SECRET=<random_secret>
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# Security
BCRYPT_ROUNDS=12
OTP_TTL_SECONDS=300
OTP_MAX_ATTEMPTS=3

# QR Cards
QR_SECRET=<random_secret>
```

---

## Project Structure

```
src/
├── app.js                      # Express app entry point
├── db/
│   ├── pool.js                 # PostgreSQL connection
│   ├── redis.js                # Redis connection
│   └── migrations/
│       ├── 000_create_users.sql
│       ├── 001_create_qr_cards.sql
│       ├── 002_update_users.sql
│       ├── 003_create_transactions.sql
│       ├── 004_create_api_partners.sql
│       └── 005_create_payment_sessions.sql
├── middleware/
│   ├── auth.js                 # JWT authentication
│   ├── partnerAuth.js          # Partner HMAC authentication
│   └── validate.js             # Input validation
├── modules/
│   ├── generateCards.js        # QR card generation logic
│   └── pdfExport.js            # PDF export functionality
├── routes/
│   ├── authRouter.js           # /auth/*
│   ├── userRouter.js           # /user/*
│   ├── cardsRouter.js          # /cards/*
│   ├── partnerRouter.js        # /api/payment/*
│   └── adminRouter.js          # /admin/*
└── services/
    ├── authService.js          # JWT, password hashing
    ├── otpService.js           # OTP management
    ├── userService.js          # User operations
    ├── transactionService.js   # Transaction logging
    └── partnerService.js       # Partner validation
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024 | Initial QR card generation module |
| 2.0.0 | 2025 | Full PointPay platform: auth, users, partners, admin |

---

## Testing

### Test Auth Flow
```bash
# 1. Register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","phone":"+1234567890","email":"test@example.com","password":"secure123"}'

# 2. Check console for OTP (dev mode) or Redis: GET otp:registration:+1234567890

# 3. Verify OTP
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+1234567890","code":"123456"}'

# 4. Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"secure123"}'
```

### Test Card Redemption
```bash
# 1. Generate cards (as admin)
curl -X POST http://localhost:3000/admin/cards/generate \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"quantity":5,"value":100,"expiresInDays":30}'

# 2. Redeem card (as user)
curl -X POST http://localhost:3000/cards/redeem \
  -H "Authorization: Bearer <user_token>" \
  -H "Content-Type: application/json" \
  -d '{"token":"<card_token>"}'
```
