# --- Etap 1: budowanie (instaluje WSZYSTKIE zależności, buduje frontend + backend) ---
FROM node:22-alpine AS builder
WORKDIR /app

# Aktywuj pnpm w wersji dokładnie takiej jak w package.json (unika błędów niezgodności)
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Najpierw same pliki manifestowe + patches/ (potrzebne przez patchedDependencies w pnpm)
COPY package.json pnpm-lock.yaml* ./
COPY patches ./patches

RUN pnpm install --frozen-lockfile

# Teraz reszta kodu i build
COPY . .
RUN pnpm run build

# --- Etap 2: uruchomienie (tylko to, co potrzebne w produkcji) ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/patches ./patches
COPY --from=builder /app/node_modules ./node_modules
RUN pnpm prune --prod

COPY --from=builder /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
