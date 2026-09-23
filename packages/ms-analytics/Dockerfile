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
COPY packages/ms-analytics/package.json ./packages/ms-analytics/

RUN pnpm --filter @ecommerce/ms-analytics... install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/ms-analytics ./packages/ms-analytics

# The shared packages must be COMPILED before this service can typecheck
# against them: each is consumed via its `types: dist/index.d.ts`, so their
# source alone resolves to nothing. The `^...` filter suffix selects exactly this
# service's workspace DEPENDENCIES and excludes the service itself.
RUN pnpm --filter "@ecommerce/ms-analytics^..." run build
RUN pnpm --filter @ecommerce/ms-analytics run build

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
COPY --from=builder /app/packages/ms-analytics/node_modules ./packages/ms-analytics/node_modules
COPY --from=builder /app/packages/ms-analytics/dist ./packages/ms-analytics/dist
COPY --from=builder /app/packages/ms-analytics/package.json ./packages/ms-analytics/package.json

# The shared packages are consumed through symlinks into these directories, so
# their COMPILED output has to be present too — the symlink resolves to a real
# path that must exist in this stage.
COPY --from=builder /app/packages/shared ./packages/shared

# The six aggregate collections live here, including the processed-event
# ledger. Declared as a volume so a rebuild does not wipe them: this consumer
# subscribes with fromBeginning, so losing the ledger while the topic retains
# its messages would REPLAY history against empty aggregates — arriving at the
# right totals only if nothing had been compacted away, and silently wrong if
# anything had.
# Both directories are created and chowned BEFORE dropping to the nodejs
# user. The logger mkdirs /app/logs at boot and the process cannot create a
# directory at the image root as non-root — the container then exits with
# EACCES before ever listening (measured 2026-09-23).
RUN mkdir -p /app/data/nedb /app/logs && chown -R nodejs:nodejs /app/data /app/logs
VOLUME ["/app/data"]

USER nodejs

EXPOSE 5467

# ⚠️ The service reads ANALYTICS_SERVICE_PORT (see src/index.ts), not PORT.
# Setting PORT here would be silently ignored and the container would listen on
# the 5467 default by coincidence rather than by configuration.
ENV ANALYTICS_SERVICE_PORT=5467
ENV NEDB_DATA_PATH=/app/data/nedb

CMD ["node", "packages/ms-analytics/dist/index.js"]
