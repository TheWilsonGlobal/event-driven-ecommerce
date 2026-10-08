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
COPY packages/gateway/package.json ./packages/gateway/

RUN pnpm --filter @ecommerce/gateway... install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/gateway ./packages/gateway

# Compile shared workspace dependencies first, then the gateway
RUN pnpm --filter "@ecommerce/gateway^..." run build
RUN pnpm --filter @ecommerce/gateway run build

# Production image, copy all the files and run the app
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/gateway/node_modules ./packages/gateway/node_modules
COPY --from=builder /app/packages/gateway/dist ./packages/gateway/dist
COPY --from=builder /app/packages/gateway/package.json ./packages/gateway/package.json
COPY --from=builder /app/packages/shared ./packages/shared

RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

USER nodejs

EXPOSE 5460

ENV PORT=5460

CMD ["node", "packages/gateway/dist/index.js"]