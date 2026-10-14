-- LOCAL REVIEW DRAFT ONLY. Never executed, including on synthetic databases.
-- Apply only after separately approved schema/RLS/concurrency validation.
-- This adds a save identity; it does not change history access or retention.
-- No history cleanup, UPDATE, DELETE, TTL, RLS policy or privilege changes.

BEGIN;

ALTER TABLE public.citation_history
  ADD COLUMN citation_request_id text
    CHECK (citation_request_id IS NULL OR length(citation_request_id) BETWEEN 8 AND 200);

-- Existing rows and deterministic/free results have NULL and remain unchanged.
-- A paid result can be saved once per owner, even after a lost acknowledgement.
-- Repeating a save uses ON CONFLICT DO NOTHING, never replacement of a row.
ALTER TABLE public.citation_history
  ADD CONSTRAINT citation_history_owner_request_unique
    UNIQUE (user_id, citation_request_id);

-- Deliberately no FK to the temporary recovery payload. Expiring the 24-hour
-- copy must not remove an independently saved history record.
COMMIT;
