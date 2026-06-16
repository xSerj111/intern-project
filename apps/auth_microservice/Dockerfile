# ==========================================
# Stage 1: Build (Builder)
# ==========================================
FROM node:20-alpine AS builder

# Set the working directory inside the container to the project root
WORKDIR /app

# Copy configuration files for the entire monorepo
COPY package*.json ./
COPY turbo.json ./

# Copy all code (be sure to use .dockerignore to avoid copying node_modules!)
COPY . .

# Install all dependencies (including devDependencies needed to build the code)
RUN npm ci

# Build the specific microservice using Turborepo
# The --filter flag ensures we only build auth_microservice and its dependencies
RUN npx turbo run build --filter=auth_microservice...

# ==========================================
# Stage 2: Production (Runner)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Set the production environment
ENV NODE_ENV=production

# Copy the main package.json to install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the built microservice files from the builder stage
COPY --from=builder /app/apps/auth_microservice/dist ./apps/auth_microservice/dist
COPY --from=builder /app/apps/auth_microservice/package.json ./apps/auth_microservice/package.json

# (Optional) If the microservice uses packages/shared, copy their built versions as well:
# COPY --from=builder /app/packages ./packages

# Auth Service runs on port 3002 (according to your .env)
EXPOSE 3002

# Run the application from the root perspective (so that paths in the monorepo match)
CMD ["node", "apps/auth_microservice/dist/main.js"]