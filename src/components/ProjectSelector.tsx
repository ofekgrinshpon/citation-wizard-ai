import { useState } from "react";
import { useProjects } from "@/hooks/useProjects";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export function ProjectSelector() {
  const { projects, currentProject, setCurrentProjectId, createProject, deleteProject } = useProjects();
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

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
    toast(`למחוק את הפרויקט "${name}"? כל האזכורים ישמחקו.`, {
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

  if (!currentProject) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 px-3 py-1.5 rounded-lg transition-colors max-w-[200px] truncate">
          📁 {currentProject.name}
          <span className="text-muted-foreground text-xs">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" style={{ direction: "rtl" }}>
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            className="flex items-center justify-between"
            onSelect={() => setCurrentProjectId(p.id)}
          >
            <span className={p.id === currentProject.id ? "font-bold" : ""}>
              {p.id === currentProject.id && "✓ "}
              {p.name}
            </span>
            {projects.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(p.id, p.name);
                }}
                className="text-destructive text-xs hover:underline mr-2"
              >
                מחק
              </button>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {showCreate ? (
          <div className="px-2 py-1.5 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="שם פרויקט..."
              className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm text-foreground"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <button onClick={handleCreate} className="text-primary text-sm font-medium">
              צור
            </button>
          </div>
        ) : (
          <DropdownMenuItem onSelect={() => setShowCreate(true)}>
            <span className="text-primary">+ פרויקט חדש</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
