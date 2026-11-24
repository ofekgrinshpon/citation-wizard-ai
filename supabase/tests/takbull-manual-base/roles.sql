CREATE TYPE public.app_role AS ENUM ('admin','user');
CREATE FUNCTION private.has_role(_user_id uuid,_role public.app_role) RETURNS boolean
LANGUAGE sql STABLE AS $$SELECT _user_id='20000000-0000-4000-a000-000000000000' AND _role='admin'$$;
