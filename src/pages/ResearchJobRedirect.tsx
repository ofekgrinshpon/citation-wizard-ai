import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Deep link for a persistent research job: /research/:jobId
 * Jobs that belong to a conversation open that conversation; legacy jobs
 * (no conversation) keep the old ?job=<id> reattach path.
 */
export default function ResearchJobRedirect() {
  const { jobId } = useParams<{ jobId: string }>();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("legal_research_jobs")
        .select("conversation_id")
        .eq("id", jobId)
        .maybeSingle();
      if (cancelled) return;
      const cid = (data as { conversation_id?: string | null } | null)?.conversation_id;
      setTarget(cid ? `/app/chat/${cid}` : `/app?job=${encodeURIComponent(jobId)}`);
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  if (!jobId) return <Navigate to="/app" replace />;
  if (!target) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return <Navigate to={target} replace />;
}
