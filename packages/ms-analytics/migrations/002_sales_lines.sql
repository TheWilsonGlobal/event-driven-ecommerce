-- Per-order-line sales history for the windowed rank engine (Redis ZSETs).
--
-- product_counters is an all-time total and cannot answer "units sold in the
-- last hour", so the ZSETs could not be rebuilt from it after a Redis flush.
-- One row per (event, product) is written in the SAME transaction as the
-- processed_events claim, so a redelivered event can never add a second row
-- (the claim fails first) and the PK is a second line of defence.
--
-- Orders consumed before this migration have no rows here: windowed rankings
-- cover only events applied after it. The all-time view stays product_counters.
--
-- Growth: rows older than the longest ranking window (7d, plus a day of slack) are
-- useless to the rank engine; RankingEngine prunes them hourly on a timer and again
-- on every rebuild. occurred_at is a real
-- timestamptz (parsed from the envelope; unparseable events write no row).
CREATE TABLE {{schema}}.sales_lines (
  event_id    text          NOT NULL,
  product_id  text          NOT NULL,
  -- NULL when the event carried no (valid) category: the category set is skipped.
  category_id text,
  quantity    numeric(18,4) NOT NULL CHECK (quantity > 0),
  occurred_at timestamptz   NOT NULL,
  PRIMARY KEY (event_id, product_id)
);
CREATE INDEX sales_lines_occurred_at_idx ON {{schema}}.sales_lines (occurred_at);
ALTER TABLE {{schema}}.sales_lines ENABLE ROW LEVEL SECURITY;
