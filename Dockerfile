# Build stage
FROM node:latest AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm i -f

# Copy source code
COPY . .

# Build the application for production
RUN npm run build

# Production stage
FROM node:latest AS production

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder /app/dist/exam-score ./dist/exam-score
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/assets /app/assets

RUN npm cache clean --force

# Expose port 4000 (default port for Angular SSR)
EXPOSE 4000

# Start the SSR server
CMD ["node", "dist/exam-score/server/server.mjs"]