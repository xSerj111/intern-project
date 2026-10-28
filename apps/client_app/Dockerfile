# syntax=docker/dockerfile:1
# Build context: the repo root (`docker build -f apps/client_app/Dockerfile .`).
ARG NODE_IMAGE=node:20-alpine
ARG TURBO_VERSION=1.13.4

# Prune the monorepo to the client and the workspaces it depends on.
FROM ${NODE_IMAGE} AS prune
ARG TURBO_VERSION
WORKDIR /repo
RUN npm install -g turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune client_app --docker

# Install every dependency (dev included) from the pruned manifests only, so
# this layer is cached until a package.json or the lockfile changes.
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY --from=prune /repo/out/json/ ./
RUN npm ci

FROM deps AS build
# Browser-visible service URLs, baked into the bundle at build time. They must be
# reachable from the user's browser (published host ports), not container names.
ARG AUTH_SERVICE_URL
ARG CORE_SERVICE_URL
ARG NOTIFICATIONS_SERVICE_URL
ARG GOOGLE_CLIENT_ID=
ENV AUTH_SERVICE_URL=${AUTH_SERVICE_URL} \
    CORE_SERVICE_URL=${CORE_SERVICE_URL} \
    NOTIFICATIONS_SERVICE_URL=${NOTIFICATIONS_SERVICE_URL} \
    GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID} \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY --from=prune /repo/out/full/ ./
# Shared compiler options; turbo prune does not carry root files over.
COPY tsconfig.json ./
RUN npx turbo run build --filter=client_app...

# The standalone output carries its own minimal node_modules; no npm ci here.
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/client_app/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/client_app/.next/static ./apps/client_app/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT}/ > /dev/null || exit 1
CMD ["node", "apps/client_app/server.js"]
