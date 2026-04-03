
-- Fix 1: Replace overly permissive INSERT policy on verified_sources
DROP POLICY "Authenticated users can insert verified sources" ON public.verified_sources;

CREATE POLICY "Authenticated users can insert pending sources"
  ON public.verified_sources FOR INSERT
  TO authenticated
  WITH CHECK (
    verification_status = 'pending'
    AND auto_verified = false
    AND verified_by IS NULL
  );

-- Fix 2: Revoke public RPC access to has_role to prevent privilege enumeration
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
