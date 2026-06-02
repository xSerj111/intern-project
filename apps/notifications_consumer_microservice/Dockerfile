# ==========================================
# Etap 1: Budowanie (Builder)
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Kopiowanie konfiguracji monorepo
COPY package*.json ./
COPY turbo.json ./

# Kopiowanie całego kodu źródłowego (zależne od poprawnego .dockerignore)
COPY . .

# Instalacja wszystkich zależności (w tym devDependencies do zbudowania)
RUN npm ci

# Budowanie powiadomień za pomocą Turborepo
RUN npx turbo run build --filter=notifications_consumer_microservice...

# ==========================================
# Etap 2: Produkcja (Runner)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Instalacja tylko zależności produkcyjnych
COPY package*.json ./
RUN npm ci --omit=dev

# Skopiowanie zbudowanych plików z etapu budowania
COPY --from=builder /app/apps/notifications_consumer_microservice/dist ./apps/notifications_consumer_microservice/dist
COPY --from=builder /app/apps/notifications_consumer_microservice/package.json ./apps/notifications_consumer_microservice/package.json

# (Opcjonalnie) Kopiowanie współdzielonych paczek, jeśli serwis z nich korzysta:
# COPY --from=builder /app/packages ./packages

# Serwis powiadomień działa na porcie 3003
EXPOSE 3003

CMD ["node", "apps/notifications_consumer_microservice/dist/main.js"]