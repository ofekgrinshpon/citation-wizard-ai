
-- Create app_role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Create citation_history table
CREATE TABLE public.citation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_input TEXT NOT NULL,
  formatted_output TEXT NOT NULL,
  source_type TEXT,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.citation_history ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (no auth required for regular usage)
CREATE POLICY "Anyone can insert citations" ON public.citation_history
  FOR INSERT WITH CHECK (true);

-- Admins can read all
CREATE POLICY "Admins can read all citations" ON public.citation_history
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Admins can update (for verification)
CREATE POLICY "Admins can update citations" ON public.citation_history
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Create verified_sources table
CREATE TABLE public.verified_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  full_citation TEXT NOT NULL,
  search_text TEXT NOT NULL,
  year TEXT,
  volume TEXT,
  page TEXT,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  auto_verified BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.verified_sources ENABLE ROW LEVEL SECURITY;

-- Everyone can read verified sources (for autocomplete)
CREATE POLICY "Anyone can read verified sources" ON public.verified_sources
  FOR SELECT USING (true);

-- Admins can insert/update/delete verified sources
CREATE POLICY "Admins can manage verified sources" ON public.verified_sources
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
