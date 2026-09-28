CREATE TABLE public.research_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  title text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_conversations TO authenticated;
GRANT ALL ON public.research_conversations TO service_role;
ALTER TABLE public.research_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversations select" ON public.research_conversations FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own conversations insert" ON public.research_conversations FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own conversations update" ON public.research_conversations FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own conversations delete" ON public.research_conversations FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX research_conversations_user_idx ON public.research_conversations (user_id, project_id, last_message_at DESC);
CREATE TRIGGER research_conversations_updated_at BEFORE UPDATE ON public.research_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.research_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.research_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','clarification','research_answer')),
  content text NOT NULL,
  job_id uuid NULL,
  footnotes jsonb NULL,
  used_sources jsonb NULL,
  attachments jsonb NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.research_messages TO authenticated;
GRANT ALL ON public.research_messages TO service_role;
ALTER TABLE public.research_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages via own conversation select" ON public.research_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.research_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
CREATE POLICY "user messages via own conversation insert" ON public.research_messages FOR INSERT TO authenticated
  WITH CHECK (role = 'user' AND EXISTS (SELECT 1 FROM public.research_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
CREATE INDEX research_messages_conv_idx ON public.research_messages (conversation_id, created_at);
CREATE UNIQUE INDEX research_messages_one_answer_per_job ON public.research_messages (job_id) WHERE kind = 'research_answer';

ALTER TABLE public.legal_research_jobs
  ADD COLUMN conversation_id uuid NULL REFERENCES public.research_conversations(id) ON DELETE SET NULL,
  ADD COLUMN trigger_message_id uuid NULL,
  ADD COLUMN response_message_id uuid NULL;
CREATE INDEX legal_research_jobs_conversation_idx ON public.legal_research_jobs (conversation_id);