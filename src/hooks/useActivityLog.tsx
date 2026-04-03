import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";

export function useActivityLog() {
  const { user } = useAuth();
  const { currentProject } = useProjects();

  const log = useCallback(
    async (action: string, details: Record<string, string | number | boolean | null> = {}) => {
      if (!user) return;
      await supabase.from("activity_logs").insert([{
        user_id: user.id,
        project_id: currentProject?.id || null,
        action,
        details,
      }]);
    },
    [user, currentProject]
  );

  return { log };
}
