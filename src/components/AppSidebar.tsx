import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function AppSidebar() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { projects, currentProject, setCurrentProjectId, createProject, deleteProject } = useProjects();
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (!user) return;
    // Try user_metadata first, then fetch from profiles
    const metaName = user.user_metadata?.full_name;
    if (metaName) {
      setDisplayName(metaName);
    } else {
      supabase.from("profiles").select("full_name").eq("id", user.id).single()
        .then(({ data }) => {
          if (data?.full_name) setDisplayName(data.full_name);
        });
    }
  }, [user]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const p = await createProject(name);
    if (p) {
      setCurrentProjectId(p.id);
      toast.success(`פרויקט "${name}" נוצר`);
    }
    setNewName("");
    setShowCreate(false);
  };

  const handleDelete = (id: string, name: string) => {
    toast(`למחוק את הפרויקט "${name}"?`, {
      action: {
        label: "מחק",
        onClick: async () => {
          await deleteProject(id);
          toast.success("הפרויקט נמחק");
        },
      },
      cancel: { label: "ביטול", onClick: () => {} },
    });
  };

  if (!user) return null;

  return (
    <aside
      className="w-full md:w-52 border-l border-border bg-muted/50 flex flex-col py-4 px-3 gap-1 overflow-y-auto overflow-x-hidden flex-shrink-0"
      style={{ direction: "rtl" }}
    >
      {/* Profile link */}
      <button
        onClick={() => navigate("/profile")}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors text-right w-full"
      >
        <span>👤</span>
        <span className="truncate">{displayName || user?.email || "הפרופיל שלי"}</span>
      </button>

      {/* Divider */}
      <div className="h-px bg-border my-2" />

      {/* Projects section label */}
      <p className="text-[10px] text-muted-foreground px-3 mb-1 font-semibold">פרויקטים</p>

      {/* Project list */}
      {projects.map((p) => (
        <div
          key={p.id}
          className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors group ${
            p.id === currentProject?.id
              ? "bg-primary/10 text-primary font-semibold"
              : "text-foreground hover:bg-muted"
          }`}
          onClick={() => setCurrentProjectId(p.id)}
        >
          <span className="truncate flex items-center gap-1.5">
            <span className="text-xs">📁</span>
            {p.name}
          </span>
          {projects.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(p.id, p.name);
              }}
              className="text-destructive text-[10px] opacity-0 group-hover:opacity-100 transition-opacity hover:underline mr-1"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {/* Create project */}
      {showCreate ? (
        <div className="px-2 mt-1 flex flex-col gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="שם פרויקט..."
            className="bg-background border border-border rounded px-2 py-1.5 text-sm text-foreground w-full min-w-0"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="text-primary text-xs font-medium">
              צור
            </button>
            <button onClick={() => { setShowCreate(false); setNewName(""); }} className="text-muted-foreground text-xs">
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-primary hover:bg-muted transition-colors text-right w-full"
        >
          <span className="text-xs">＋</span>
          פרויקט חדש
        </button>
      )}

      {/* Admin link */}
      {isAdmin && (
        <>
          <div className="h-px bg-border my-2" />
          <button
            onClick={() => navigate("/admin")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-primary hover:bg-muted transition-colors text-right w-full"
          >
            <span>⚙</span>
            <span>ניהול</span>
          </button>
        </>
      )}
    </aside>
  );
}
