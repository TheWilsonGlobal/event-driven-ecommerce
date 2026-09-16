FROM node:18-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared ./packages/shared
COPY packages/order-service/package.json ./packages/order-service/

RUN pnpm --filter @ecommerce/order-service... install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/order-service ./packages/order-service

RUN pnpm --filter @ecommerce/order-service run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

COPY --from=builder /app/packages/order-service/dist ./dist
COPY --from=builder /app/packages/order-service/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

USER nodejs

EXPOSE 3003

ENV PORT=3003

CMD ["node", "dist/index.js"]