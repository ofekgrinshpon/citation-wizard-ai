import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { useCredits } from "@/hooks/useCredits";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Pencil, Infinity as InfinityIcon, HelpCircle } from "lucide-react";
import { UserGuideModal } from "@/components/guide/UserGuideModal";

export function AppSidebar() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { projects, currentProject, setCurrentProjectId, createProject, renameProject, deleteProject, loading: projectsLoading } = useProjects();
  const { planMeta, isAdmin: isAdminCredits } = useCredits();
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);


  const initial = useMemo(() => {
    const source = (displayName || user?.email || "").trim();
    const ch = Array.from(source)[0] ?? "?";
    return ch.toUpperCase();
  }, [displayName, user?.email]);

  useEffect(() => {
    if (!user) return;
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
    if (!name || projectsLoading) return;
    const p = await createProject(name);
    if (!p) {
      toast.error("לא הצלחנו ליצור פרויקט חדש");
      return;
    }
    setCurrentProjectId(p.id);
    toast.success(`פרויקט "${name}" נוצר`);
    setNewName("");
    setShowCreate(false);
  };

  const handleRename = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === projects.find((p) => p.id === id)?.name) {
      setEditingId(null);
      return;
    }
    await renameProject(id, trimmed);
    toast.success("שם הפרויקט עודכן");
    setEditingId(null);
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
      className="h-full w-full md:w-52 border-l border-border bg-muted/50 flex flex-col py-4 px-3 gap-1 overflow-y-auto overflow-x-hidden flex-shrink-0"
      style={{ direction: "rtl" }}
    >
      <button
        onClick={() => navigate("/profile?tab=account")}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted transition-colors text-right w-full group"
        title={isAdminCredits ? "Admin — ללא הגבלה" : planMeta.label}
      >
        <span
          aria-hidden
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted border border-border/60 text-foreground font-semibold text-sm group-hover:border-primary/40 transition-colors"
        >
          {isAdminCredits ? <InfinityIcon className="w-4 h-4 text-primary" /> : initial}
        </span>
        <span className="flex flex-col min-w-0 flex-1 leading-tight">
          <span className="text-sm font-medium text-foreground truncate">
            {displayName || user?.email || "הפרופיל שלי"}
          </span>
          <span className="text-[11px] text-muted-foreground truncate">
            {isAdminCredits ? "Admin" : planMeta.label}
          </span>
          <span className="text-[10px] text-muted-foreground/70 mt-0.5">ניהול חשבון</span>
        </span>
      </button>

      <div className="h-px bg-border my-2" />

      <p className="text-[10px] text-muted-foreground px-3 mb-1 font-semibold">פרויקטים</p>

      {projectsLoading ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">טוען פרויקטים...</div>
      ) : (
        projects.map((p) => (
          <div
            key={p.id}
            className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors group ${
              p.id === currentProject?.id
                ? "bg-primary/10 text-primary font-semibold"
                : "text-foreground hover:bg-muted"
            }`}
            onClick={() => setCurrentProjectId(p.id)}
          >
            {editingId === p.id ? (
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => handleRename(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(p.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="bg-background border border-border rounded px-1.5 py-0.5 text-sm text-foreground w-full min-w-0"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="truncate flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-xs">📁</span>
                {p.name}
              </span>
            )}
            {editingId !== p.id && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity mr-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(p.id);
                    setEditName(p.name);
                  }}
                  className="text-muted-foreground hover:text-foreground p-0.5"
                  title="שנה שם"
                >
                  <Pencil size={11} />
                </button>
                {projects.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(p.id, p.name);
                    }}
                    className="text-destructive text-[10px] hover:underline"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
        ))
      )}

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
          disabled={projectsLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-primary hover:bg-muted transition-colors text-right w-full disabled:opacity-50 disabled:pointer-events-none"
        >
          <span className="text-xs">＋</span>
          פרויקט חדש
        </button>
      )}

      <div className="h-px bg-border my-2" />
      <button
        onClick={() => navigate("/verified-sources")}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-primary hover:bg-muted transition-colors text-right w-full"
      >
        <span>📚</span>
        <span>מקורות מאומתים</span>
      </button>

      <button
        onClick={() => setGuideOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-primary hover:bg-muted transition-colors text-right w-full"
      >
        <HelpCircle size={14} />
        <span>איך זה עובד?</span>
      </button>

      <UserGuideModal open={guideOpen} onOpenChange={setGuideOpen} />

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
