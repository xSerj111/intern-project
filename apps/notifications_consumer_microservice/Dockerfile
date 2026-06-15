# ==========================================
# Stage 1: Build (Builder)
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy monorepo configuration
COPY package*.json ./
COPY turbo.json ./

# Copy all source code (depends on a correct .dockerignore)
COPY . .

# Install all dependencies (including devDependencies to build)
RUN npm ci

# Build notifications using Turborepo
RUN npx turbo run build --filter=notifications_consumer_microservice...

# ==========================================
# Stage 2: Production (Runner)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built files from the build stage
COPY --from=builder /app/apps/notifications_consumer_microservice/dist ./apps/notifications_consumer_microservice/dist
COPY --from=builder /app/apps/notifications_consumer_microservice/package.json ./apps/notifications_consumer_microservice/package.json

# (Optional) Copy shared packages if the service uses them:
# COPY --from=builder /app/packages ./packages

# Notifications service runs on port 3003
EXPOSE 3003

CMD ["node", "apps/notifications_consumer_microservice/dist/main.js"]