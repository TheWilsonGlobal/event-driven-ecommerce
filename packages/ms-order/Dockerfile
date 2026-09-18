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
COPY packages/ms-order/package.json ./packages/ms-order/
COPY packages/ms-order/prisma ./packages/ms-order/prisma

RUN pnpm --filter @ecommerce/ms-order... install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/ms-order ./packages/ms-order

RUN pnpm --filter @ecommerce/ms-order exec prisma generate
RUN pnpm --filter @ecommerce/ms-order run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

COPY --from=builder /app/packages/ms-order/dist ./dist
COPY --from=builder /app/packages/ms-order/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

USER nodejs

EXPOSE 5465

ENV PORT=5465

CMD ["node", "dist/index.js"]