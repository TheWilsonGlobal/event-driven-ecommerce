-- ms-analytics write model. {{schema}} is replaced by the shared migration
-- runner (ms_analytics in production, a throwaway schema in tests).
--
-- Counters are plain integer/numeric columns updated with
--   INSERT ... ON CONFLICT (key) DO UPDATE SET n = t.n + EXCLUDED.n
-- so two writers cannot lose an update (the old NeDB read-modify-write could).
--
-- Money is numeric(18,4): exact sums, with enough scale for quantity * unitPrice
-- lines. Counts are integer; the two progress counters are bigint because they
-- grow for the life of the service.
--
-- Every table has ROW LEVEL SECURITY enabled and NO policies: the service role
-- bypasses RLS, while anything reaching this schema through PostgREST with the
-- publishable key sees nothing.

-- Idempotency ledger. event_id PRIMARY KEY is the dedupe key: the handler's
-- first statement is INSERT ... ON CONFLICT (event_id) DO NOTHING inside the
-- same transaction as the counter bumps.
CREATE TABLE {{schema}}.processed_events (
  event_id     text        PRIMARY KEY,
  event_type   text        NOT NULL,
  -- When the FACT occurred, exactly as the envelope carried it. text rather
  -- than timestamptz on purpose: an unparseable value must be recorded as
  -- received, not rejected (the whole transaction would roll back) or coerced.
  occurred_at  text        NOT NULL,
  topic        text        NOT NULL,
  partition    integer     NOT NULL,
  kafka_offset text        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE {{schema}}.processed_events ENABLE ROW LEVEL SECURITY;

-- One row per UTC hour. hour_key is 'YYYY-MM-DDTHH', which sorts chronologically
-- as text. currency stays NULL until a priced event lands (never defaulted).
CREATE TABLE {{schema}}.hour_buckets (
  hour_key  text           PRIMARY KEY,
  orders    integer        NOT NULL DEFAULT 0 CHECK (orders >= 0),
  confirmed integer        NOT NULL DEFAULT 0 CHECK (confirmed >= 0),
  cancelled integer        NOT NULL DEFAULT 0 CHECK (cancelled >= 0),
  revenue   numeric(18,4)  NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  currency  text
);
ALTER TABLE {{schema}}.hour_buckets ENABLE ROW LEVEL SECURITY;

CREATE TABLE {{schema}}.product_counters (
  product_id    text          PRIMARY KEY,
  sku           text          NOT NULL DEFAULT '',
  -- numeric, not integer: the handler accepts any finite non-negative quantity
  -- (it never required a whole number), and an integer column would turn a
  -- fractional one into a rolled-back transaction.
  units_ordered numeric(18,4) NOT NULL DEFAULT 0 CHECK (units_ordered >= 0),
  times_ordered integer       NOT NULL DEFAULT 0 CHECK (times_ordered >= 0),
  revenue       numeric(18,4) NOT NULL DEFAULT 0 CHECK (revenue >= 0)
);
ALTER TABLE {{schema}}.product_counters ENABLE ROW LEVEL SECURITY;

-- The three singletons. `id boolean PRIMARY KEY CHECK (id)` allows exactly one
-- row (id = true). A MISSING row means "nothing has ever been applied", which
-- the read layer renders distinctly from "every counter is genuinely zero", so
-- none of them is seeded here.
CREATE TABLE {{schema}}.funnel (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  created      integer NOT NULL DEFAULT 0 CHECK (created >= 0),
  confirmed    integer NOT NULL DEFAULT 0 CHECK (confirmed >= 0),
  cancelled    integer NOT NULL DEFAULT 0 CHECK (cancelled >= 0),
  reserved     integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  insufficient integer NOT NULL DEFAULT 0 CHECK (insufficient >= 0)
);
ALTER TABLE {{schema}}.funnel ENABLE ROW LEVEL SECURITY;

CREATE TABLE {{schema}}.payment_outcomes (
  id              boolean       PRIMARY KEY DEFAULT true CHECK (id),
  captured        integer       NOT NULL DEFAULT 0 CHECK (captured >= 0),
  failed          integer       NOT NULL DEFAULT 0 CHECK (failed >= 0),
  refunded        integer       NOT NULL DEFAULT 0 CHECK (refunded >= 0),
  captured_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (captured_amount >= 0),
  refunded_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0)
);
ALTER TABLE {{schema}}.payment_outcomes ENABLE ROW LEVEL SECURITY;

CREATE TABLE {{schema}}.progress (
  id                 boolean     PRIMARY KEY DEFAULT true CHECK (id),
  events_processed   bigint      NOT NULL DEFAULT 0 CHECK (events_processed >= 0),
  duplicates_skipped bigint      NOT NULL DEFAULT 0 CHECK (duplicates_skipped >= 0),
  -- NULL until the first applied event; only ever moves forward (GREATEST).
  last_event_at      timestamptz,
  last_processed_at  timestamptz
);
ALTER TABLE {{schema}}.progress ENABLE ROW LEVEL SECURITY;
