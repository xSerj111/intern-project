# syntax=docker/dockerfile:1
# Build context: the repo root (`docker build -f apps/auth_microservice/Dockerfile .`).
ARG NODE_IMAGE=node:20-alpine
ARG TURBO_VERSION=1.13.4

# Prune the monorepo to auth and the workspaces it depends on.
FROM ${NODE_IMAGE} AS prune
ARG TURBO_VERSION
WORKDIR /repo
RUN npm install -g turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune auth_microservice --docker

# Install every dependency (dev included) from the pruned manifests only, so
# this layer is cached until a package.json or the lockfile changes.
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY --from=prune /repo/out/json/ ./
RUN npm ci

FROM deps AS build
COPY --from=prune /repo/out/full/ ./
# Shared compiler options; turbo prune does not carry root files over.
COPY tsconfig.json ./
RUN npx turbo run build --filter=auth_microservice...

FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prune /repo/out/json/ ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/auth_microservice/dist ./apps/auth_microservice/dist
WORKDIR /repo/apps/auth_microservice
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${AUTH_PORT:-3002}/health > /dev/null || exit 1
CMD ["node", "dist/main.js"]
