ALTER TABLE public.verified_sources ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('verified', 'pending', 'invalid'));

-- Update existing rows to 'verified' since they were already approved
UPDATE public.verified_sources SET verification_status = 'verified' WHERE verification_status = 'pending';