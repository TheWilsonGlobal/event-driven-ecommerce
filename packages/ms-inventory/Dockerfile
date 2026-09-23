FROM node:18-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# tsconfig.json is the base every package's own tsconfig extends. Without it
# tsc fails with TS5083 and then reports every workspace import as unresolved,
# which reads like a missing dependency rather than a missing config file.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/ms-inventory/package.json ./packages/ms-inventory/

RUN pnpm --filter @ecommerce/ms-inventory... install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/ms-inventory ./packages/ms-inventory

# The shared packages must be COMPILED before this service can typecheck
# against them: each is consumed via its `types: dist/index.d.ts`, so their
# source alone resolves to nothing. The `^...` filter suffix selects exactly this
# service's workspace DEPENDENCIES and excludes the service itself.
RUN pnpm --filter "@ecommerce/ms-inventory^..." run build
RUN pnpm --filter @ecommerce/ms-inventory run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# ⚠️ The WORKSPACE LAYOUT is preserved rather than flattened.
#
# pnpm does not hoist runtime dependencies to the root: /app/node_modules holds
# only the root devDependencies plus the .pnpm content-addressed store, and the
# real dependencies are SYMLINKS at packages/<svc>/node_modules pointing into
# that store. Copying only the root node_modules therefore produces an image
# that builds cleanly and then dies at startup with
# `Error: Cannot find module 'fastify'` (measured 2026-09-23).
#
# So the app keeps its original path, and both node_modules trees come along:
# the symlink farm AND the store it points into.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/ms-inventory/node_modules ./packages/ms-inventory/node_modules
COPY --from=builder /app/packages/ms-inventory/dist ./packages/ms-inventory/dist
COPY --from=builder /app/packages/ms-inventory/package.json ./packages/ms-inventory/package.json

# The shared packages are consumed through symlinks into these directories, so
# their COMPILED output has to be present too — the symlink resolves to a real
# path that must exist in this stage.
COPY --from=builder /app/packages/shared ./packages/shared

# NeDB writes its .db files here. Declared as a volume so stock levels and the
# processed-event ledger survive `docker compose up --build` — without it the
# idempotency ledger is wiped on every rebuild and a redelivered order would
# reserve stock a second time.
# Both directories are created and chowned BEFORE dropping to the nodejs
# user. The logger mkdirs /app/logs at boot and the process cannot create a
# directory at the image root as non-root — the container then exits with
# EACCES before ever listening (measured 2026-09-23).
RUN mkdir -p /app/data/nedb /app/logs && chown -R nodejs:nodejs /app/data /app/logs
VOLUME ["/app/data"]

USER nodejs

EXPOSE 5466

# ⚠️ The service reads INVENTORY_SERVICE_PORT (see src/index.ts), not PORT.
# Setting PORT here would be silently ignored and the container would listen on
# the 5466 default by coincidence rather than by configuration.
ENV INVENTORY_SERVICE_PORT=5466
ENV NEDB_DATA_PATH=/app/data/nedb

CMD ["node", "packages/ms-inventory/dist/index.js"]
