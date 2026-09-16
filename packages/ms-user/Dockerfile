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
COPY packages/ms-user/package.json ./packages/ms-user/
COPY packages/ms-user/prisma ./packages/ms-user/prisma

RUN pnpm --filter @ecommerce/ms-user... install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/ms-user ./packages/ms-user

RUN pnpm --filter @ecommerce/ms-user exec prisma generate
RUN pnpm --filter @ecommerce/ms-user run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

COPY --from=builder /app/packages/ms-user/dist ./dist
COPY --from=builder /app/packages/ms-user/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

USER nodejs

EXPOSE 3001

ENV PORT=3001

CMD ["node", "dist/index.js"]