
-- Add subscription columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN is_subscribed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN citation_count INTEGER NOT NULL DEFAULT 0;

-- Drop the existing permissive update policy
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Users can only update their own full_name (not is_subscribed or citation_count directly)
CREATE POLICY "Users can update own profile name"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Admins can update any profile (including is_subscribed)
CREATE POLICY "Admins can update any profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Function to increment citation_count for the calling user
CREATE OR REPLACE FUNCTION public.increment_citation_count()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles
  SET citation_count = citation_count + 1
  WHERE id = auth.uid();
$$;
