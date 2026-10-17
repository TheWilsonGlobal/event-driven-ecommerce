# Infrastructure and observability

Ports, backing services, search, caches, metrics and logs. [← Back to the README](../README.md)

## Service ports

| Service | Port | Description |
|---|---|---|
| **API Gateway** | `5460` | Public API Gateway (`/api-docs`, reverse proxy) |
| **Admin Cockpit** | `5461` | React + Vite centralized administration UI |
| **Web Client** | `5462` | Next.js 14 SSR customer storefront |
| **ms-user** | `5463` | User, authentication, and JWT authorization service |
| **ms-product** | `5464` | Catalog, Elasticsearch search, and category service |
| **ms-order** | `5465` | Checkout, BullMQ queues, and payment saga service |
| **ms-inventory** | `5466` | Stock reservation and Kafka inventory event consumer |
| **ms-analytics** | `5467` | Order and payment event aggregation consumer |
| **PostgreSQL** | `5432` | Relational database (infra-hub) |
| **Redis** | `6379` | Key-value cache and BullMQ broker (infra-hub) |
| **MongoDB** | `27017` | Document database (infra-hub) |
| **Elasticsearch** | `9200` | Full-text search engine (infra-hub) |
| **Prometheus** | `9090` | Metrics scraper (infra-hub) |
| **Grafana** | `3005` | Observability dashboards (infra-hub) |
| **Kafka Broker** | `9100` | Redpanda / Kafka wire protocol (infra-hub) |
| **Kafka Admin** | `9101` | Redpanda admin API / lag sampler (infra-hub) |
| **Kafka Console** | `9102` | Redpanda web console (infra-hub) |

## Backing services

**No backing service is defined in this repo.** PostgreSQL, MongoDB, Redis,
Elasticsearch, RustFS, Prometheus, Grafana, and Kafka/Redpanda all live in the shared `hub` repo (`C:\Git\APPs\hub`),
which owns their lifecycle:

```bash
cd ../../hub
docker compose up -d                      # Core backing services (Redis, etc.)
docker compose --profile all up -d        # Plus Postgres, Mongo, ES, Prometheus, Grafana, Redpanda
```

Ports are standard, so running the app on the host via `pnpm run dev` reaches
them on `localhost` using this repo's existing `.env` values — no code change.

`docker-compose.yml` here defines only the internal application services and
joins hub's network as `external` (`infra-hub_infra-network`), which keeps container
hostnames (`DB_HOST: postgres`, `REDIS_HOST: redis`, `KAFKA_BROKER: redpanda`, …) resolving. **Start
hub first**, or compose fails with "network not found".

RustFS object data lives at `C:\Hub\RustFS` (see `RUSTFS_DATA_PATH`), outside
both repos.

## Search (Elasticsearch)

`ms-product` indexes products into Elasticsearch and uses it to answer
`GET /api/v1/products?search=`. The Postgres `ms_product` schema (jsonb documents) is the **source of truth** (NeDB is only the legacy driver) — the index
is a search accelerator, never the record.

```bash
cd ../../hub && docker compose --profile search up -d
```

- Every write path (seed, create, update, delete) mirrors into the index, and
  the whole catalogue is re-indexed from the database on each boot, so a wiped or stale
  index self-heals on restart.
- Search results are ranked by relevance, tolerate a typo (`fuzziness: AUTO`)
  and match on `tags`/`sku` as well as title and description — none of which the
  previous substring scan could do.
- Matching ids are resolved back to database records before the response is built,
  so the API can never serve a stale indexed copy.

`GET /health` reports cluster status from a **10s cache**, so a liveness probe
never blocks on Elasticsearch: it answers in ~3ms whether the cluster is up or
down (an uncached probe took ~2.5s during an outage). The `search.cachedAgeMs`
field gives the age of that reading.

**When Elasticsearch is down the endpoint still works**, falling back to the old
in-memory substring filter. The response's `searchEngine` field
(`elasticsearch` | `memory` | `none`) says which path answered, and
`GET /health` reports cluster reachability and the indexed document count.
Set `ELASTICSEARCH_ENABLED=false` to skip it entirely and avoid the
connection timeout on every search.

## Caching and rankings (Redis)

- **Product cache-aside** (ms-product): `GET /api/v1/products/:id` reads `cache:product:{id}` first; concurrent misses
  share one load (in-process single-flight plus a Redis lock); entries expire after 1 h plus up to 5 min of jitter and are
  deleted on every create, update and delete (with a second delayed delete). Requests made with a service token (ms-order's
  price check) bypass the cache so a price is never stale. Metric: `product_cache_requests_total{result}`.
  Redis down means direct reads, no errors.
- **Sales rankings** (ms-analytics): each consumed `order.created` adds units sold to bucketed Redis sorted sets
  (`rank:global:{1h,24h,7d}`, plus `rank:cat:{id}:{window}` when order lines carry a `categoryId`). The answer reports
  `source: redis|postgres`; if Redis is unavailable it falls back to Postgres (all-time for the global ranking). The
  `sales_lines` table feeds rebuilds and is pruned hourly. Redelivered events never double count.

## Monitoring

- Health check endpoints: `/health`
- Metrics: Prometheus endpoints at `/metrics`
- Logging: Structured JSON logs
- Error Tracking: Sentry integration

## Metrics (Prometheus + Grafana)

All backend services expose `GET /metrics` via the shared plugin in
[`packages/shared/utils/src/metrics.ts`](packages/shared/utils/src/metrics.ts):
request counts, latency histograms and Node process/event-loop stats, each
labelled with `service`.

```bash
cd ../../hub && docker compose --profile monitoring up -d
```

- Prometheus (<http://localhost:9090>) scrapes all four over
  `host.docker.internal`, since the services run on the host via `pnpm`.
- Grafana (<http://localhost:3005>, `admin`/`admin`) auto-provisions the
  Prometheus datasource and a **Micro-services Overview** dashboard from
  committed files in `infra-hub/monitoring/grafana/`.

Grafana also has an **Elasticsearch (products)** datasource pointed at the
search index. It is for browsing indexed documents in **Explore**, not for
dashboards: the index has no date field, so time-series panels built on it
return nothing. In Explore, set **Query type → Raw Data**; the default "Logs"
mode fails with `elasticsearch time field name is required`, since Logs and
Metrics both need a timestamp field this index does not have. Use Prometheus for graphs. Add datasources by committing a file
under `infra-hub/monitoring/grafana/provisioning/datasources/` rather than
clicking through the UI, so they survive a wiped data directory.

## Logs (Loki)

All backend services ship their pino logs to Loki via `pino-loki`,
configured once in
[`packages/shared/utils/src/logger.ts`](packages/shared/utils/src/logger.ts).
Logs go to the terminal **and** Loki, so `pnpm run dev` looks exactly as before.

```bash
cd ../../hub && docker compose --profile logging up -d
```

Query them in Grafana → **Explore** → **Loki**:

| Query | Finds |
|---|---|
| `{service="ms-product"}` | everything from one service |
| `{service=~"ms-.*\|gateway"}` | all four services |
| `{level="error"}` | errors only |
| `{service="ms-order"} \|= "payment"` | full-text search within a service |

Labels are `service`, `level` and `env` — kept low-cardinality on purpose. Never
add a request id or URL as a label; each distinct value creates a Loki stream.
Log bodies stay searchable with `|=` regardless.

Shipping is in-process rather than via Docker's log driver because the services
run on the **host** under `pnpm`, so there is no container stdout to collect.
**If Loki is down the services are unaffected** — they log to the terminal and
keep serving; set `LOKI_ENABLED=false` to disable shipping entirely.

Targets show as `down` for any service that isn't running — expected during
partial local development, not an outage. Latency is labelled with route
**patterns** (`/api/v1/products/:id`), never raw URLs, to keep metric
cardinality bounded.
