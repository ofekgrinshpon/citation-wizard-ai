DROP POLICY "Admins can read all qa_logs" ON public.qa_logs;

CREATE POLICY "Admins can read all qa_logs"
  ON public.qa_logs
  FOR SELECT
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));