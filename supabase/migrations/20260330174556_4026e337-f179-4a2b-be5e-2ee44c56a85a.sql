
-- Fix permissive INSERT policy - restrict to anon and authenticated
DROP POLICY "Anyone can insert citations" ON public.citation_history;
CREATE POLICY "Authenticated or anon can insert citations" ON public.citation_history
  FOR INSERT TO anon, authenticated WITH CHECK (true);
