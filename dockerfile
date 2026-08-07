# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source (relies on .dockerignore to exclude node_modules, .env, etc.)
COPY . .

# Build the Astro project
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime

# Run as non-root user
RUN addgroup -S labrepo && adduser -S labrepo -G labrepo

WORKDIR /app

# Copy built assets and production dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

RUN chown -R labrepo:labrepo /app

USER labrepo

# Astro Node standalone server
ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4321/ || exit 1

CMD ["node", "./dist/server/entry.mjs"]
