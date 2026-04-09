# PointPay - Loyalty Platform Backend

A comprehensive loyalty platform with QR card generation, user authentication, partner API integration, and admin management.

## Features

- **User Authentication** - JWT-based auth with OTP verification
- **QR Card System** - Generate, validate, and redeem loyalty cards
- **Partner API** - HMAC-authenticated API for merchant integrations
- **Admin Dashboard** - User management, card generation, statistics
- **Transaction History** - Complete audit trail for all operations

## Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Database:** PostgreSQL 15
- **Cache:** Redis 7
- **Authentication:** JWT + bcrypt
- **Containerization:** Docker & Docker Compose

## Quick Start

### Prerequisites

- Node.js >= 18
- Docker & Docker Compose
- Git

### 1. Clone the Repository

```bash
git clone <repository-url>
cd QR-card-generation
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pointpay
DB_USER=postgres
DB_PASSWORD=your_secure_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT (generate with: openssl rand -hex 64)
JWT_ACCESS_SECRET=your_access_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# Security
BCRYPT_ROUNDS=12
OTP_TTL_SECONDS=300
OTP_MAX_ATTEMPTS=3

# QR Cards (generate with: openssl rand -hex 32)
QR_SECRET=your_qr_secret_here
```

### 4. Start Services with Docker

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on port 5432
- Redis on port 6379
- API server on port 3000

### 5. Run Migrations

Connect to PostgreSQL and run migration files:

```bash
# Option 1: Using psql
psql -h localhost -U postgres -d pointpay -f src/db/migrations/000_create_users.sql
psql -h localhost -U postgres -d pointpay -f src/db/migrations/001_create_qr_cards.sql
psql -h localhost -U postgres -d pointpay -f src/db/migrations/002_update_users.sql
psql -h localhost -U postgres -d pointpay -f src/db/migrations/003_create_transactions.sql
psql -h localhost -U postgres -d pointpay -f src/db/migrations/004_create_api_partners.sql
psql -h localhost -U postgres -d pointpay -f src/db/migrations/005_create_payment_sessions.sql

# Option 2: Using Docker
docker exec -i pointpay-db psql -U postgres -d pointpay < src/db/migrations/000_create_users.sql
docker exec -i pointpay-db psql -U postgres -d pointpay < src/db/migrations/001_create_qr_cards.sql
docker exec -i pointpay-db psql -U postgres -d pointpay < src/db/migrations/002_update_users.sql
docker exec -i pointpay-db psql -U postgres -d pointpay < src/db/migrations/003_create_transactions.sql
docker exec -i pointpay-db psql -U postgres -d pointpay < src/db/migrations/004_create_api_partners.sql
docker exec -i pointpay-db psql -U postgres -d pointpay < src/db/migrations/005_create_payment_sessions.sql
```

### 6. Start Development Server

```bash
# With auto-reload
npm run dev

# Or production mode
npm start
```

### 7. Verify Installation

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{"status":"ok","timestamp":"2025-01-01T00:00:00.000Z","version":"1.0.0"}
```

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register new user (sends OTP) |
| POST | `/auth/verify-otp` | Verify OTP and create account |
| POST | `/auth/login` | Login with email/password |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/resend-otp` | Resend registration OTP |

### User

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/user/profile` | JWT | Get user profile |
| GET | `/user/balance` | JWT | Get balance only |
| GET | `/user/transactions` | JWT | Transaction history |
| GET | `/user/transactions/summary` | JWT | Transaction stats |

### Cards

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/cards/redeem` | JWT | Redeem QR card |
| POST | `/cards/validate-only` | - | Validate without redeeming |

### Partner API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/payment/initiate` | HMAC | Start payment session |
| POST | `/api/payment/confirm` | HMAC | Confirm with OTP |
| GET | `/api/payment/status/:id` | HMAC | Get session status |
| GET | `/api/payment/user/:id/balance` | HMAC | Check user balance |

### Admin

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/users` | Admin | List users |
| GET | `/admin/users/:id` | Admin | Get user details |
| PATCH | `/admin/users/:id/block` | Admin | Block/unblock user |
| PATCH | `/admin/users/:id/balance` | Admin | Adjust balance |
| POST | `/admin/cards/generate` | Admin | Generate QR cards |
| GET | `/admin/cards` | Admin | List cards |
| GET | `/admin/cards/batch/:id/pdf` | Admin | Download batch PDF |
| POST | `/admin/partners` | Admin | Create partner |
| GET | `/admin/partners` | Admin | List partners |
| GET | `/admin/stats` | Admin | Platform statistics |

## Usage Examples

### Register a New User

```bash
# Step 1: Start registration
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "password": "securePassword123"
  }'

# Step 2: Check console/Redis for OTP code (dev mode)
# Redis key: otp:registration:+1234567890

# Step 3: Verify OTP
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+1234567890",
    "code": "123456"
  }'
```

### Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "securePassword123"
  }'
```

Response:
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com",
    "balance": 0
  },
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG..."
}
```

### Generate Cards (Admin)

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

### Redeem Card

```bash
curl -X POST http://localhost:3000/cards/redeem \
  -H "Authorization: Bearer <user_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<qr_card_token>"
  }'
```

### Partner Payment Integration

```bash
# Generate signature
TIMESTAMP=$(date +%s)
BODY='{"userId":"<user_uuid>","amount":100}'
SIGNATURE=$(echo -n "${TIMESTAMP}POST/api/payment/initiate${BODY}" | \
  openssl dgst -sha256 -hmac "<api_secret>" | cut -d' ' -f2)

# Initiate payment
curl -X POST http://localhost:3000/api/payment/initiate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <api_key>" \
  -H "X-Timestamp: $TIMESTAMP" \
  -H "X-Signature: $SIGNATURE" \
  -d "$BODY"
```

## Project Structure

```
src/
├── app.js                      # Express app entry point
├── db/
│   ├── pool.js                 # PostgreSQL connection
│   ├── redis.js                # Redis connection
│   └── migrations/             # SQL migration files
├── middleware/
│   ├── auth.js                 # JWT authentication
│   ├── partnerAuth.js          # Partner HMAC auth
│   └── validate.js             # Input validation
├── modules/
│   ├── generateCards.js        # QR card generation
│   └── pdfExport.js            # PDF export
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

## Scripts

```bash
npm start       # Run production server
npm run dev     # Run with auto-reload (nodemon)
npm test        # Run tests with coverage
npm run lint    # Run ESLint
```

## Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop services
docker-compose down

# Reset database (WARNING: deletes data)
docker-compose down -v
docker-compose up -d
```

## Creating an Admin User

After registration, manually update a user to admin:

```sql
UPDATE users SET is_admin = true WHERE email = 'admin@example.com';
```

## Security Notes

- Generate strong secrets for JWT and QR_SECRET in production
- Use HTTPS in production
- Configure proper CORS settings
- Set appropriate rate limits
- Use IP whitelisting for partner APIs
- Regularly rotate API credentials

## License

ISC

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

## Support

For issues and feature requests, please use the GitHub issue tracker.
