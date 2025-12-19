FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package*.json ./
COPY ../../package*.json ../../
COPY ../../packages/shared/package*.json ../../packages/shared/
COPY ../../packages/shared/types/package*.json ../../packages/shared/types/
COPY ../../packages/shared/utils/package*.json ../../packages/shared/utils/
COPY ../../packages/shared/database/package*.json ../../packages/shared/database/

RUN npm ci --only=production

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER nodejs

EXPOSE 3001

ENV PORT 3001

CMD ["node", "dist/index.js"]