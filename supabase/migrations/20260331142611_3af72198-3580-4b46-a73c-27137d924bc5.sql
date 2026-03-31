
-- Update identity key function to support section-level hierarchy
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
  pub_source text;
  initial_page text;
  extracted_section text;
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
    -- Extract section number if present (e.g., סעיף 3 ל...)
    extracted_section := substring(coalesce(_full_citation, '') from '^סעיף\s+([\dא-ת()./\\–-]+)\s+ל');

    -- Extract law name (strip section prefix)
    extracted_law_name := trim(
      regexp_replace(
        coalesce(_full_citation, ''),
        '^סעיף\s+[\dא-ת()./\\–-]+\s+ל',
        '',
        'g'
      )
    );

    -- Extract publication source and initial page
    pub_source := substring(extracted_law_name from '(ס"ח|ס״ח|ק"ת|ק״ת)');
    initial_page := substring(extracted_law_name from '(?:ס"ח|ס״ח|ק"ת|ק״ת)\s+(\d+)');

    -- Strip year suffixes, gazette refs, page refs from the name for normalization
    extracted_law_name := trim(
      regexp_replace(
        extracted_law_name,
        ',\s*(התש[[:alnum:]"״''׳\-–]+\s*[–-]\s*\d{4}|\d{4}|ס"ח\s*\d+.*|ס״ח\s*\d+.*|ק"ת\s*\d+.*|ק״ת\s*\d+.*|עמ[.]?\s*\d+.*|עמוד\s*\d+.*)$',
        '',
        'g'
      )
    );
    extracted_law_name := lower(trim(regexp_replace(extracted_law_name, '\s+', ' ', 'g')));

    IF extracted_law_name <> '' THEN
      RETURN 'law:' || extracted_law_name
        || coalesce('|' || extracted_year, '')
        || coalesce('|' || lower(pub_source), '')
        || coalesce('|' || initial_page, '')
        || CASE WHEN extracted_section IS NOT NULL THEN '|section:' || lower(trim(extracted_section)) ELSE '' END;
    END IF;

    RETURN 'law:' || md5(normalized_name || '|' || normalized_citation);
  END IF;

  IF extracted_year IS NOT NULL THEN
    RETURN 'lit:' || normalized_name || '|' || extracted_year;
  END IF;

  RETURN 'lit:' || md5(normalized_name || '|' || normalized_citation);
END;
$$;

-- Recompute all identity keys
UPDATE public.verified_sources
SET identity_key = public.compute_verified_source_identity(source_type, source_name, full_citation, year);

-- Deduplicate after recomputation
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
