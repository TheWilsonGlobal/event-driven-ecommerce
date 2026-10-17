-- ms-inventory write model. {{schema}} is replaced by the shared migration
-- runner (ms_inventory in production, a throwaway schema in tests).
--
-- Four tables, all written inside ONE transaction per consumed event:
-- the stock rows, the reservation, the idempotency ledger and the outbox.
-- That atomicity is the point of moving off NeDB (see src/events/handlers.ts).
--
-- Every table has ROW LEVEL SECURITY enabled and NO policies: the service role
-- bypasses RLS, while anything reaching this schema through PostgREST with the
-- publishable key sees nothing.

-- One row per product. The CHECKs are the last line of defence: the handler
-- decides all-or-nothing in code, but a bug there can no longer drive stock
-- negative -- the offending transaction fails and rolls back whole.
CREATE TABLE {{schema}}.inventory (
  product_id text        PRIMARY KEY,
  sku        text,
  available  int         NOT NULL CHECK (available >= 0),
  reserved   int         NOT NULL CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE {{schema}}.inventory ENABLE ROW LEVEL SECURITY;

-- order_id PRIMARY KEY is "guard 2": however many order.created events (each
-- with its own eventId) describe one order, only one INSERT can win. It is also
-- what makes a second order.cancelled find RELEASED and credit nothing.
CREATE TABLE {{schema}}.reservations (
  order_id     text        PRIMARY KEY,
  order_number text,
  -- eventId of the order.created that caused the reservation; the BullMQ expiry
  -- job id is derived from it, so keep it traceable from the row.
  event_id     text,
  items        jsonb       NOT NULL,
  status       text        NOT NULL CHECK (status IN ('RESERVED', 'RELEASED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz
);
ALTER TABLE {{schema}}.reservations ENABLE ROW LEVEL SECURITY;

-- Idempotency ledger (guard 1). The handler's first statement is
-- INSERT ... ON CONFLICT (event_id) DO NOTHING, in the same transaction as the
-- effect it guards, so the row exists if and only if the effect does.
CREATE TABLE {{schema}}.processed_events (
  event_id     text        PRIMARY KEY,
  event_type   text        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  -- NULL only inside the transaction that claimed the event; the handler sets
  -- it before COMMIT, so a committed row always carries the decision.
  outcome      text
);
ALTER TABLE {{schema}}.processed_events ENABLE ROW LEVEL SECURITY;

-- Transactional outbox. Shape is fixed by shared-messaging's OutboxRelay
-- (claimBatch / markSent / markFailed read and write exactly these columns).
CREATE TABLE {{schema}}.outbox_events (
  seq             bigserial   PRIMARY KEY,
  event_id        uuid        NOT NULL UNIQUE,
  topic           text        NOT NULL,
  partition_key   text        NOT NULL,
  event_type      text        NOT NULL,
  envelope        jsonb       NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts        int         NOT NULL DEFAULT 0,
  max_attempts    int         NOT NULL DEFAULT 10,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_by       text,
  locked_until    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
-- The relay's per-key ordering check (earlier unsent row, same key) walks this.
CREATE INDEX outbox_events_key_seq_idx
  ON {{schema}}.outbox_events (partition_key, seq);
-- Partial: sent rows are the vast majority and the claim query never wants them.
CREATE INDEX outbox_events_claim_idx
  ON {{schema}}.outbox_events (next_attempt_at)
  WHERE status IN ('pending', 'processing');
ALTER TABLE {{schema}}.outbox_events ENABLE ROW LEVEL SECURITY;
