-- Only the signed dedicated-page receiver calls this service-only function.
-- Preserve the function, privileges, locks and all other settlement decisions.
DO $status_patch$
DECLARE
  fn regprocedure := 'public.settle_citation_pass_order(text,text,text,integer,text,integer,integer)'::regprocedure;
  definition text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=fn) IS DISTINCT FROM '6d15c921b4c45f07d09ba44761a4fdca' THEN
    RAISE EXCEPTION 'Settlement definition drift; stop without changes';
  END IF;
  definition := pg_get_functiondef(fn);
  EXECUTE replace(definition,
    '_order_status IS DISTINCT FROM 2',
    '(_order_status IS NULL OR _order_status NOT IN (2,3))');
END;
$status_patch$;