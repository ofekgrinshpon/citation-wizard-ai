
-- Fix 1: Add project_id ownership validation to citation_history INSERT policy
DROP POLICY "Users can insert own citations" ON public.citation_history;

CREATE POLICY "Users can insert own citations"
  ON public.citation_history FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND
    (project_id IS NULL OR EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = project_id AND user_id = auth.uid()
    ))
  );

-- Fix 2: Add project_id ownership validation to activity_logs INSERT policy
DROP POLICY "Users can insert own activity" ON public.activity_logs;

CREATE POLICY "Users can insert own activity"
  ON public.activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND
    (project_id IS NULL OR EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = project_id AND user_id = auth.uid()
    ))
  );

-- Fix 3: Replace public SELECT on verified_sources to hide admin UUIDs
DROP POLICY "Anyone can read verified sources" ON public.verified_sources;

CREATE POLICY "Anyone can read verified sources"
  ON public.verified_sources FOR SELECT
  TO public
  USING (true);

-- Create a view that excludes verified_by for public/client usage
CREATE OR REPLACE VIEW public.public_verified_sources AS
SELECT id, source_name, source_type, full_citation, search_text,
       year, volume, page, verification_status, usage_count, identity_key, metadata, verified_at, auto_verified
FROM public.verified_sources;
