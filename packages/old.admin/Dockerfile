FROM node:18-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared ./packages/shared
COPY packages/admin/package.json ./packages/admin/

RUN pnpm --filter @ecommerce/admin... install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/admin ./packages/admin

RUN pnpm --filter @ecommerce/admin run build

FROM nginx:alpine AS runner
COPY --from=builder /app/packages/admin/dist /usr/share/nginx/html

RUN echo 'server { \
    listen 3005; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $$uri $$uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 3005

CMD ["nginx", "-g", "daemon off;"]
