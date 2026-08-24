CREATE TABLE public.verified_legal_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_category text NOT NULL,
  source_type text NOT NULL,
  authority_type text,
  normalized_docket text,
  case_prefix text,
  canonical_title text,
  party_names text[] NOT NULL DEFAULT '{}',
  statute_title text,
  statute_section text,
  authors text[] NOT NULL DEFAULT '{}',
  journal_or_publisher text,
  court text,
  institution text,
  year integer,
  official_url text,
  source_host text,
  source_kind text,
  language text,
  is_translation boolean NOT NULL DEFAULT false,
  body_text_hash text NOT NULL,
  body_chars integer NOT NULL DEFAULT 0,
  identity_terms_matched text[] NOT NULL DEFAULT '{}',
  identity_validated boolean NOT NULL DEFAULT false,
  bibliographic_validated boolean NOT NULL DEFAULT false,
  acquisition_method text,
  status text NOT NULL DEFAULT 'verified',
  verified_at timestamp with time zone,
  last_success_at timestamp with time zone,
  last_used_at timestamp with time zone,
  failure_count integer NOT NULL DEFAULT 0,
  last_failure_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.verified_legal_sources TO service_role;
ALTER TABLE public.verified_legal_sources ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX verified_legal_sources_dedupe_idx
  ON public.verified_legal_sources (
    source_category,
    COALESCE(normalized_docket, ''),
    COALESCE(statute_title, ''),
    COALESCE(statute_section, ''),
    body_text_hash
  );
CREATE INDEX verified_legal_sources_docket_idx ON public.verified_legal_sources (normalized_docket);
CREATE INDEX verified_legal_sources_statute_idx ON public.verified_legal_sources (statute_title, statute_section);
CREATE INDEX verified_legal_sources_title_trgm_idx ON public.verified_legal_sources USING gin (canonical_title extensions.gin_trgm_ops);
CREATE INDEX verified_legal_sources_verified_idx ON public.verified_legal_sources (status) WHERE status = 'verified';

CREATE TRIGGER update_verified_legal_sources_updated_at
BEFORE UPDATE ON public.verified_legal_sources
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.verified_legal_source_texts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES public.verified_legal_sources(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  text text NOT NULL,
  source_url text,
  embedding extensions.vector,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.verified_legal_source_texts TO service_role;
ALTER TABLE public.verified_legal_source_texts ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX verified_legal_source_texts_chunk_idx
  ON public.verified_legal_source_texts (source_id, chunk_index);