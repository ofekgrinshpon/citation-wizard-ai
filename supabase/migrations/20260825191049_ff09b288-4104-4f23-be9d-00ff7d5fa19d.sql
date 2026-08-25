ALTER TABLE public.verified_legal_sources
  ADD COLUMN IF NOT EXISTS identity_validation_version text,
  ADD COLUMN IF NOT EXISTS identity_evidence_type text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS identity_evidence_summary text,
  ADD COLUMN IF NOT EXISTS identity_confidence text,
  ADD COLUMN IF NOT EXISTS validated_docket text,
  ADD COLUMN IF NOT EXISTS validated_title text,
  ADD COLUMN IF NOT EXISTS validation_source text,
  ADD COLUMN IF NOT EXISTS invalidated_reason text;

-- identity_hardening_and_cache_purge_v1: purge every judgment body that was
-- accepted on weak evidence (no docket proof) plus the statute row whose body
-- is a judgment PDF. Bodies are deleted so nothing can be reused or cited.
DELETE FROM public.verified_legal_source_texts
WHERE source_id IN (
  '8a9e614f-a0cd-44b0-ad89-3a83e23f0dee',
  'b8ba82b6-a97b-488b-82ed-668362249efc',
  'c9abd313-2480-4596-bf45-b91b5061840f',
  'ff0a9bd4-2a49-4398-8644-6ebd25844c94',
  'a372934e-07a0-41e7-ad07-3554ec4dcfb9'
);

UPDATE public.verified_legal_sources
SET identity_validated = false,
    status = 'identity_mismatch',
    body_chars = 0,
    invalidated_reason = 'identity_hardening_v1_purge:wrong_or_unproven_body',
    identity_terms_matched = '{}',
    identity_evidence_type = '{}',
    identity_confidence = 'none',
    identity_validation_version = 'identity_hardening_v1',
    last_failure_reason = 'identity_hardening_v1_purge',
    failure_count = GREATEST(failure_count, 1),
    updated_at = now()
WHERE id IN (
  '8a9e614f-a0cd-44b0-ad89-3a83e23f0dee',
  'b8ba82b6-a97b-488b-82ed-668362249efc',
  'c9abd313-2480-4596-bf45-b91b5061840f',
  'ff0a9bd4-2a49-4398-8644-6ebd25844c94',
  'a372934e-07a0-41e7-ad07-3554ec4dcfb9'
);