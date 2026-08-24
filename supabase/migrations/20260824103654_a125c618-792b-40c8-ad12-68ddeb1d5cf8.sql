ALTER TABLE public.verified_legal_sources
  ADD COLUMN IF NOT EXISTS dedupe_docket text GENERATED ALWAYS AS (COALESCE(normalized_docket, '')) STORED,
  ADD COLUMN IF NOT EXISTS dedupe_statute_title text GENERATED ALWAYS AS (COALESCE(statute_title, '')) STORED,
  ADD COLUMN IF NOT EXISTS dedupe_statute_section text GENERATED ALWAYS AS (COALESCE(statute_section, '')) STORED,
  ADD COLUMN IF NOT EXISTS discovery_strategy text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS discovery_version text NOT NULL DEFAULT 'v0';

DROP INDEX IF EXISTS public.verified_legal_sources_dedupe_idx;

CREATE UNIQUE INDEX IF NOT EXISTS verified_legal_sources_dedupe2_idx
  ON public.verified_legal_sources
  (source_category, dedupe_docket, dedupe_statute_title, dedupe_statute_section, body_text_hash);

CREATE INDEX IF NOT EXISTS verified_legal_sources_strategy_idx
  ON public.verified_legal_sources (discovery_strategy, discovery_version);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.verified_legal_sources TO authenticated;
GRANT ALL ON public.verified_legal_sources TO service_role;