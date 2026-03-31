CREATE OR REPLACE FUNCTION public.compute_verified_source_identity(
  _source_type text,
  _source_name text,
  _full_citation text,
  _year text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  normalized_name text;
  normalized_citation text;
  extracted_case_number text;
  extracted_law_name text;
  extracted_year text;
BEGIN
  normalized_name := lower(trim(regexp_replace(coalesce(_source_name, ''), '\s+', ' ', 'g')));
  normalized_citation := lower(trim(regexp_replace(coalesce(_full_citation, ''), '\s+', ' ', 'g')));
  extracted_year := nullif(trim(coalesce(_year, '')), '');

  IF coalesce(_source_type, '') = 'caselaw' THEN
    extracted_case_number := substring(coalesce(_full_citation, '') from '(?:בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|ת"א|ת״א|ע"ע|ע״ע|עע"מ|עע״מ|בש"פ|בש״פ|ת"פ|ת״פ|תפ"ח|תפ״ח|עמ"ה|עמ״ה|בר"ם|בר״ם)\s+([0-9]+/[0-9]+)');
    IF extracted_case_number IS NOT NULL THEN
      RETURN 'case:' || extracted_case_number;
    END IF;
    RETURN 'case:' || md5(normalized_name || '|' || normalized_citation);
  END IF;

  IF coalesce(_source_type, '') IN ('legislation_primary', 'legislation_secondary') THEN
    extracted_law_name := trim(
      regexp_replace(
        coalesce(_full_citation, ''),
        '^[Ss]ection\s+[^ ]+\s+of\s+|^סעיף\s+[\dא-ת()./\\–-]+\s+ל',
        '',
        'g'
      )
    );
    extracted_law_name := trim(
      regexp_replace(
        extracted_law_name,
        ',\s*(התש[[:alnum:]"״''׳\-–]+\s*[–-]\s*\d{4}|\d{4}|ס"ח\s*\d+.*|ק"ת\s*\d+.*|עמ[.]?\s*\d+.*|עמוד\s*\d+.*)$',
        '',
        'g'
      )
    );
    extracted_law_name := lower(trim(regexp_replace(extracted_law_name, '\s+', ' ', 'g')));

    IF extracted_law_name <> '' THEN
      IF extracted_year IS NOT NULL THEN
        RETURN 'law:' || extracted_law_name || '|' || extracted_year;
      END IF;
      RETURN 'law:' || extracted_law_name;
    END IF;

    RETURN 'law:' || md5(normalized_name || '|' || normalized_citation);
  END IF;

  IF extracted_year IS NOT NULL THEN
    RETURN 'lit:' || normalized_name || '|' || extracted_year;
  END IF;

  RETURN 'lit:' || md5(normalized_name || '|' || normalized_citation);
END;
$$;

ALTER TABLE public.verified_sources
ADD COLUMN IF NOT EXISTS identity_key text;

UPDATE public.verified_sources
SET identity_key = public.compute_verified_source_identity(source_type, source_name, full_citation, year)
WHERE identity_key IS NULL OR identity_key = '';

CREATE OR REPLACE FUNCTION public.set_verified_source_identity_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.identity_key := public.compute_verified_source_identity(NEW.source_type, NEW.source_name, NEW.full_citation, NEW.year);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_verified_source_identity_key_before_write ON public.verified_sources;
CREATE TRIGGER set_verified_source_identity_key_before_write
BEFORE INSERT OR UPDATE ON public.verified_sources
FOR EACH ROW
EXECUTE FUNCTION public.set_verified_source_identity_key();

WITH ranked AS (
  SELECT
    id,
    identity_key,
    usage_count,
    verification_status,
    verified_at,
    row_number() OVER (
      PARTITION BY identity_key
      ORDER BY
        CASE verification_status WHEN 'verified' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        usage_count DESC,
        verified_at ASC,
        id ASC
    ) AS rn,
    sum(usage_count) OVER (PARTITION BY identity_key) AS total_usage
  FROM public.verified_sources
  WHERE identity_key IS NOT NULL AND identity_key <> ''
), master_updates AS (
  UPDATE public.verified_sources v
  SET usage_count = r.total_usage
  FROM ranked r
  WHERE v.id = r.id AND r.rn = 1
  RETURNING v.id
)
DELETE FROM public.verified_sources v
USING ranked r
WHERE v.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS verified_sources_identity_key_unique_idx
ON public.verified_sources (identity_key)
WHERE identity_key IS NOT NULL AND identity_key <> '';

CREATE INDEX IF NOT EXISTS verified_sources_identity_key_idx
ON public.verified_sources (identity_key);