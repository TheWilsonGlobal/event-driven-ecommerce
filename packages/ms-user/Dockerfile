FROM node:18-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/ms-user/package.json ./packages/ms-user/
COPY packages/ms-user/prisma ./packages/ms-user/prisma

RUN pnpm --filter @ecommerce/ms-user... install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/ms-user ./packages/ms-user

RUN pnpm --filter "@ecommerce/ms-user^..." run build
RUN pnpm --filter @ecommerce/ms-user exec prisma generate
RUN pnpm --filter @ecommerce/ms-user run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache openssl
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/ms-user/node_modules ./packages/ms-user/node_modules
COPY --from=builder /app/packages/ms-user/dist ./packages/ms-user/dist
COPY --from=builder /app/packages/ms-user/package.json ./packages/ms-user/package.json
COPY --from=builder /app/packages/ms-user/prisma ./packages/ms-user/prisma
COPY --from=builder /app/packages/shared ./packages/shared

RUN mkdir -p /app/logs /app/data/db && chown -R nodejs:nodejs /app/logs /app/data

USER nodejs

EXPOSE 5463

ENV PORT=5463
ENV DATABASE_URL="file:../../../data/db/ms-user.db"

CMD ["node", "packages/ms-user/dist/index.js"]