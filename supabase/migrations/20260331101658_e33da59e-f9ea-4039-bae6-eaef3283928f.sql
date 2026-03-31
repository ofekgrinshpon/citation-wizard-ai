
CREATE POLICY "Authenticated users can insert verified sources"
ON public.verified_sources
FOR INSERT
TO authenticated
WITH CHECK (true);
