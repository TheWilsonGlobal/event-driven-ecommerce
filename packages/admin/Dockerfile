FROM node:18-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/admin/package.json ./packages/admin/

RUN pnpm --filter @ecommerce/admin... install --frozen-lockfile

# Build Vite static assets
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/admin ./packages/admin

RUN pnpm --filter "@ecommerce/admin^..." run build
RUN pnpm --filter @ecommerce/admin run build

# Production image with lightweight Nginx web server
FROM nginx:alpine AS runner
WORKDIR /usr/share/nginx/html

# Clean default Nginx site files
RUN rm -rf ./*

# Copy built SPA artifacts
COPY --from=builder /app/packages/admin/dist ./

# Configure Nginx for SPA client routing and port 5461
RUN echo 'server { \
    listen 5461; \
    server_name localhost; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
    error_page 500 502 503 504 /50x.html; \
    location = /50x.html { \
        root /usr/share/nginx/html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 5461

CMD ["nginx", "-g", "daemon off;"]
