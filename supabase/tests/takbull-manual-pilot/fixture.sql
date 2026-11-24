CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA private; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('test.uid',true),'')::uuid$$;
CREATE FUNCTION public._require_usage_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF current_setting('test.rpc_role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF; END;
$$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
INSERT INTO profiles VALUES('10000000-0000-4000-a000-000000000000'),('20000000-0000-4000-a000-000000000000');
CREATE FUNCTION test_assert(_ok boolean,_label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 IF _ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',_label; END IF;
END;$$;
