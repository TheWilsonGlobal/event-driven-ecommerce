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
COPY packages/client/package.json ./packages/client/

RUN pnpm --filter @ecommerce/client... install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/client ./packages/client

ENV NEXT_TELEMETRY_DISABLED 1

RUN pnpm --filter @ecommerce/client run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

COPY --from=builder /app/packages/client/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nodejs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nodejs:nodejs /app/packages/client/.next/standalone ./
COPY --from=builder --chown=nodejs:nodejs /app/packages/client/.next/static ./.next/static

USER nodejs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]