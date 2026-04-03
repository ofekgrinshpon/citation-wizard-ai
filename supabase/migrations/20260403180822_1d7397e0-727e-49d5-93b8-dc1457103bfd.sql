CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;

ALTER POLICY "Admins can read all citations"
ON public.citation_history
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins can update citations"
ON public.citation_history
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins can read all projects"
ON public.projects
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins can read all profiles"
ON public.profiles
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins can delete roles"
ON public.user_roles
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins can insert roles"
ON public.user_roles
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins can read all roles"
ON public.user_roles
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins can read all activity"
ON public.activity_logs
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Admins can manage verified sources"
ON public.verified_sources
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;