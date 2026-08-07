# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY server/package.json server/package-lock.json ./

# Install dependencies
RUN npm ci

# Copy server source
COPY server/src ./src
COPY server/tsconfig.json ./

# Build TypeScript
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime

# Run as non-root user
RUN addgroup -S labrepo && adduser -S labrepo -G labrepo

WORKDIR /app

# Copy built output and production dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY server/drizzle ./drizzle

# Create data directory for dev fallback (SQLite + mock storage)
RUN mkdir -p /app/data && chown -R labrepo:labrepo /app

USER labrepo

ENV API_PORT=3001
ENV API_HOST=0.0.0.0
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
