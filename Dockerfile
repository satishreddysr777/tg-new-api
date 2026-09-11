# syntax=docker/dockerfile:1

# ── 1. install all deps (incl. dev) ─────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. compile TypeScript → dist/ ───────────────────────────────────────────
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── 3. lean runtime image ────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# SQL migrations + journal, read by `node dist/db/migrate.js` (PRE_DEPLOY job)
COPY drizzle ./drizzle
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
