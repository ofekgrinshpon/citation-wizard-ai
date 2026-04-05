import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface ProjectsContextValue {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProjectId: (id: string) => void;
  createProject: (name: string) => Promise<Project | null>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  loading: boolean;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

const LS_CURRENT_PROJECT = "current_project_id";

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectIdRaw] = useState<string | null>(
    () => {
      try { return localStorage.getItem(LS_CURRENT_PROJECT); } catch { return null; }
    }
  );
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      setProjects([]);
      setCurrentProjectIdRaw(null);
      try { localStorage.removeItem(LS_CURRENT_PROJECT); } catch {}
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to fetch projects", error);
      setLoading(false);
      return;
    }

    const list = (data as Project[]) || [];
    setProjects(list);

    if (list.length > 0 && (!currentProjectId || !list.find((p) => p.id === currentProjectId))) {
      setCurrentProjectIdRaw(list[0].id);
      try { localStorage.setItem(LS_CURRENT_PROJECT, list[0].id); } catch {}
    }

    setLoading(false);
  }, [authLoading, user, currentProjectId]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const setCurrentProjectId = (id: string) => {
    setCurrentProjectIdRaw(id);
    try { localStorage.setItem(LS_CURRENT_PROJECT, id); } catch {}
  };

  const createProject = async (name: string): Promise<Project | null> => {
    if (!user || authLoading) return null;
    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: user.id, name })
      .select()
      .single();

    if (error || !data) {
      console.error("Failed to create project", error);
      return null;
    }

    const p = data as Project;
    setProjects((prev) => [...prev, p]);
    return p;
  };

  const renameProject = async (id: string, name: string) => {
    await supabase.from("projects").update({ name }).eq("id", id);
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  const deleteProject = async (id: string) => {
    await supabase.from("projects").delete().eq("id", id);
    setProjects((prev) => {
      const remaining = prev.filter((p) => p.id !== id);
      if (currentProjectId === id && remaining.length > 0) {
        setCurrentProjectId(remaining[0].id);
      }
      return remaining;
    });
  };

  const currentProject = projects.find((p) => p.id === currentProjectId) || null;

  return (
    <ProjectsContext.Provider
      value={{ projects, currentProject, setCurrentProjectId, createProject, renameProject, deleteProject, loading }}
    >
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects must be used within ProjectsProvider");
  return ctx;
}
