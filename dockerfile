FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the Astro project
RUN npm run build

# Runtime stage
FROM node:22-alpine AS runtime

WORKDIR /app

# Copy built assets and dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Environment variables for Astro Node standalone server
ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321

# Start the server
CMD ["node", "./dist/server/entry.mjs"]
