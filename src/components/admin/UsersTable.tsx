import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  is_subscribed?: boolean;
  citation_count?: number;
}

interface UsersTableProps {
  users: UserProfile[];
  onToggleSubscription?: (userId: string, newValue: boolean) => void;
}

const UsersTable = ({ users, onToggleSubscription }: UsersTableProps) => {
  const [search, setSearch] = useState("");

  const filtered = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (u.email?.toLowerCase().includes(q)) || (u.full_name?.toLowerCase().includes(q));
  });

  const handleToggle = async (userId: string, current: boolean) => {
    const newValue = !current;
    const { error } = await supabase
      .from("profiles")
      .update({ is_subscribed: newValue } as any)
      .eq("id", userId);
    if (error) {
      toast.error("שגיאה בעדכון סטטוס מנוי");
      return;
    }
    toast.success(newValue ? "המשתמש הוגדר כמנוי" : "המנוי בוטל");
    onToggleSubscription?.(userId, newValue);
  };

  return (
    <div className="space-y-3">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="חפש לפי אימייל או שם..."
        className="max-w-sm"
        dir="rtl"
      />
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">אימייל</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם מלא</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">תאריך הצטרפות</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">אזכורים</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">מנוי</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground">
                    אין משתמשים רשומים
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-foreground">{u.email || "—"}</td>
                    <td className="px-4 py-3 text-foreground">{u.full_name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(u.created_at).toLocaleDateString("he-IL")}
                    </td>
                    <td className="px-4 py-3 text-foreground text-xs">{u.citation_count ?? 0}</td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={u.is_subscribed ?? false}
                        onCheckedChange={() => handleToggle(u.id, u.is_subscribed ?? false)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default UsersTable;
