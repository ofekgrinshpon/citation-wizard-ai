import { Navigate, useParams } from "react-router-dom";

/**
 * Deep link for a persistent research job: /research/:jobId
 * The research panel lives inside the main app shell, so we hand the job id
 * over as ?job=<id> and let the panel reattach to the server-side job.
 */
export default function ResearchJobRedirect() {
  const { jobId } = useParams<{ jobId: string }>();
  if (!jobId) return <Navigate to="/app" replace />;
  return <Navigate to={`/app?job=${encodeURIComponent(jobId)}`} replace />;
}
