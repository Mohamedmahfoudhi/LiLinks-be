FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY .env.example ./.env

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "src/app.js"]
