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
COPY packages/user-service/package.json ./packages/user-service/

RUN pnpm --filter @ecommerce/user-service... install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/user-service ./packages/user-service

RUN pnpm --filter @ecommerce/user-service run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

COPY --from=builder /app/packages/user-service/dist ./dist
COPY --from=builder /app/packages/user-service/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

USER nodejs

EXPOSE 3001

ENV PORT=3001

CMD ["node", "dist/index.js"]