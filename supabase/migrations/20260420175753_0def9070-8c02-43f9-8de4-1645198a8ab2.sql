-- Public bucket to host the ReLex logo for email templates
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-assets', 'email-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read for email-assets (needed so email clients can fetch the logo)
DROP POLICY IF EXISTS "Email assets are publicly readable" ON storage.objects;
CREATE POLICY "Email assets are publicly readable"
ON storage.objects
FOR SELECT
USING (bucket_id = 'email-assets');