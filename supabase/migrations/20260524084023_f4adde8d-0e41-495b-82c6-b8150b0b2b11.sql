
-- 1. Restrict profile updates: prevent users from modifying plan/credit/billing fields
DROP POLICY IF EXISTS "Users can update own profile name" ON public.profiles;

CREATE POLICY "Users can update own profile name"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Enforce column-level: revoke broad UPDATE, grant only safe columns to authenticated
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

-- 2. Lock down public.has_role (the canonical one is private.has_role).
-- Revoke execute from anon/authenticated on the public copy to prevent role probing.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, authenticated, PUBLIC;

-- 3. Add explicit storage UPDATE policy for user-documents (owner-scoped)
DROP POLICY IF EXISTS "Users can update own documents" ON storage.objects;
CREATE POLICY "Users can update own documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'user-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'user-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
