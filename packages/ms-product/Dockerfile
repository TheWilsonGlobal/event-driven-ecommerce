FROM node:18-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/ms-product/package.json ./packages/ms-product/

RUN pnpm --filter @ecommerce/ms-product... install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/ms-product ./packages/ms-product

RUN pnpm --filter "@ecommerce/ms-product^..." run build
RUN pnpm --filter @ecommerce/ms-product run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/ms-product/node_modules ./packages/ms-product/node_modules
COPY --from=builder /app/packages/ms-product/dist ./packages/ms-product/dist
COPY --from=builder /app/packages/ms-product/package.json ./packages/ms-product/package.json
COPY --from=builder /app/packages/shared ./packages/shared

RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

USER nodejs

EXPOSE 5464

ENV PORT=5464

CMD ["node", "packages/ms-product/dist/index.js"]