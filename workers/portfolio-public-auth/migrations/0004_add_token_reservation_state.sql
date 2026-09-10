-- Track whether a rolling quota row is settled, provisional, released, or
-- awaiting provider usage after an interrupted model execution.
ALTER TABLE rolling_token_usage
  ADD COLUMN state TEXT NOT NULL DEFAULT 'reserved'
  CHECK (state IN ('reserved', 'in-flight', 'settled', 'released', 'unknown'));

ALTER TABLE rolling_token_usage
  ADD COLUMN settled_at INTEGER;

-- Rows written by the previous runtime with actual usage are already settled.
UPDATE rolling_token_usage
SET state = 'settled', settled_at = created_at
WHERE actual_input_tokens IS NOT NULL
  AND actual_output_tokens IS NOT NULL
  AND state = 'reserved';

CREATE INDEX IF NOT EXISTS rolling_token_usage_sub_state_created_idx
  ON rolling_token_usage(sub, state, created_at);
