# ==========================================
# Etap 1: Budowanie (Builder)
# ==========================================
FROM node:20-alpine AS builder

# Ustawienie katalogu roboczego wewnątrz kontenera na root projektu
WORKDIR /app

# Skopiowanie plików konfiguracyjnych całego monorepo
COPY package*.json ./
COPY turbo.json ./

# Skopiowanie całego kodu (koniecznie użyj .dockerignore, aby nie kopiować node_modules!)
COPY . .

# Instalacja wszystkich zależności (w tym devDependencies potrzebnych do zbudowania kodu)
RUN npm ci

# Budowanie konkretnego mikroserwisu za pomocą Turborepo
# Flaga --filter sprawia, że budujemy tylko core_microservice i to, od czego on zależy
RUN npx turbo run build --filter=core_microservice...

# ==========================================
# Etap 2: Produkcja (Runner)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Ustawienie środowiska produkcyjnego
ENV NODE_ENV=production

# Kopiowanie głównego package.json w celu instalacji tylko zależności produkcyjnych
COPY package*.json ./
RUN npm ci --omit=dev

# Kopiowanie zbudowanych plików mikroserwisu z etapu builder
COPY --from=builder /app/apps/core_microservice/dist ./apps/core_microservice/dist
COPY --from=builder /app/apps/core_microservice/package.json ./apps/core_microservice/package.json

# (Opcjonalnie) Jeśli mikroserwis korzysta z packages/shared, skopiuj też ich zbudowane wersje:
# COPY --from=builder /app/packages ./packages

# Core Service działa na porcie 3001 (zgodnie z Twoim .env)
EXPOSE 3001

# Uruchomienie aplikacji z perspektywy roota (aby ścieżki w monorepo się zgadzały)
CMD ["node", "apps/core_microservice/dist/main.js"]