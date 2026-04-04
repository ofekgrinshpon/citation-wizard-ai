import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";

interface ActivityLog {
  id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
  project_id: string | null;
}

const Profile = () => {
  const { user, signOut } = useAuth();
  const { isSubscribed, citationCount, isLimitReached, limit } = useSubscription();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") || "profile";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [citations, setCitations] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate("/");
      return;
    }
    loadProfile();
    loadActivity();
    loadCitations();
  }, [user]);

  const loadProfile = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();
    if (data) {
      setFullName(data.full_name || "");
      setEmail(data.email || user.email || "");
    }
    setLoading(false);
  };

  const loadActivity = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("activity_logs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setActivities((data as ActivityLog[]) || []);
  };

  const loadCitations = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("citation_history")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    setCitations(data || []);
  };

  const updateProfile = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", user.id);
    if (error) toast.error("שגיאה בשמירה");
    else toast.success("הפרופיל עודכן");
  };

  const filteredCitations = citations.filter((c) =>
    !searchQuery ||
    c.raw_input?.includes(searchQuery) ||
    c.formatted_output?.includes(searchQuery)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" style={{ direction: "rtl" }}>
      <header className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="text-2xl sm:text-3xl">👤</div>
          <h1 className="text-foreground text-base sm:text-lg font-bold">הפרופיל שלי</h1>
        </div>
        <div className="flex gap-1.5 sm:gap-2">
          <button
            onClick={() => navigate("/app")}
            className="text-[10px] sm:text-xs text-primary hover:bg-primary/10 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg transition-colors"
          >
            ← חזרה
          </button>
          <button
            onClick={async () => { await signOut(); navigate("/"); }}
            className="text-[10px] sm:text-xs text-destructive hover:bg-destructive/10 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg transition-colors"
          >
            התנתק
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-3 sm:p-6">
        <Tabs defaultValue="profile" dir="rtl">
          <TabsList className="w-full justify-start mb-4 sm:mb-6 overflow-x-auto no-scrollbar">
            <TabsTrigger value="profile" className="text-xs sm:text-sm">פרטים אישיים</TabsTrigger>
            <TabsTrigger value="history" className="text-xs sm:text-sm">היסטוריית אזכורים</TabsTrigger>
            <TabsTrigger value="activity" className="text-xs sm:text-sm">יומן פעילות</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">שם מלא</label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">אימייל</label>
                <Input value={email} disabled dir="ltr" />
              </div>
              <button
                onClick={updateProfile}
                className="px-6 py-2.5 rounded-xl font-semibold text-sm text-primary-foreground"
                style={{ background: "var(--gradient-primary)" }}
              >
                שמור שינויים
              </button>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-4">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="חפש באזכורים..."
              />
              {filteredCitations.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">אין אזכורים עדיין</p>
              ) : (
                <div className="space-y-2">
                  {filteredCitations.map((c) => (
                    <div key={c.id} className="bg-card border border-border rounded-lg p-3">
                      <div className="text-xs text-muted-foreground mb-1">
                        {format(new Date(c.created_at), "dd/MM/yyyy HH:mm")}
                        {c.source_type && (
                          <span className="mr-2 text-primary">• {c.source_type}</span>
                        )}
                      </div>
                      <p className="text-sm text-foreground">{c.formatted_output}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="activity">
            {activities.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">אין פעילות עדיין</p>
            ) : (
              <div className="space-y-2">
                {activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 bg-card border border-border rounded-lg p-3">
                    <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-foreground font-medium">{a.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(a.created_at), "dd/MM/yyyy HH:mm")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Profile;
