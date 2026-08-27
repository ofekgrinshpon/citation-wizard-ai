CREATE TABLE IF NOT EXISTS public.secondary_source_bodies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  final_url text,
  content_hash text NOT NULL,
  title text,
  source_type text,
  mapped_type text,
  type_confidence text,
  acquisition_path text,
  extraction_method text,
  content_type text,
  body_chars integer NOT NULL DEFAULT 0,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS secondary_source_bodies_url_key ON public.secondary_source_bodies (url);
CREATE INDEX IF NOT EXISTS secondary_source_bodies_hash_idx ON public.secondary_source_bodies (content_hash);

GRANT ALL ON public.secondary_source_bodies TO service_role;

ALTER TABLE public.secondary_source_bodies ENABLE ROW LEVEL SECURITY;