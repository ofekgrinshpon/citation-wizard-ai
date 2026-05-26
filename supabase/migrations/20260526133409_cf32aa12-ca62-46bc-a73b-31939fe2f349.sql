
-- 1) Column-level restriction on profiles updates by users
DROP POLICY IF EXISTS "Users can update own profile name" ON public.profiles;

REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

CREATE POLICY "Users can update own profile name"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 2) Remove publicly callable has_role; private.has_role remains for internal RLS use
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role);
