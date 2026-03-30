import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface CitationRecord {
  id: string;
  raw_input: string;
  formatted_output: string;
  source_type: string | null;
  is_verified: boolean;
  created_at: string;
}

interface VerifiedSource {
  id: string;
  source_name: string;
  source_type: string;
  full_citation: string;
  auto_verified: boolean;
  verified_at: string;
  usage_count: number;
}

const Admin = () => {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [verifiedSources, setVerifiedSources] = useState<VerifiedSource[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"history" | "verified" | "analytics">("analytics");

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) {
      navigate("/auth");
    }
  }, [user, isAdmin, authLoading, navigate]);

  useEffect(() => {
    if (isAdmin) fetchData();
  }, [isAdmin]);

  const fetchData = async () => {
    setLoadingData(true);
    const [citRes, verRes] = await Promise.all([
      supabase.from("citation_history").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("verified_sources").select("*").order("verified_at", { ascending: false }),
    ]);
    if (citRes.data) setCitations(citRes.data);
    if (verRes.data) setVerifiedSources(verRes.data);
    setLoadingData(false);
  };

  const toggleVerification = async (citation: CitationRecord) => {
    const newState = !citation.is_verified;
    const { error } = await supabase
      .from("citation_history")
      .update({ is_verified: newState })
      .eq("id", citation.id);

    if (error) {
      toast.error("שגיאה בעדכון");
      return;
    }

    if (newState) {
      // Add to verified sources
      await supabase.from("verified_sources").insert({
        source_name: citation.raw_input.substring(0, 100),
        source_type: citation.source_type || "unknown",
        full_citation: citation.formatted_output,
        search_text: citation.raw_input.toLowerCase(),
        auto_verified: false,
        verified_by: user?.id,
      });
    }

    setCitations((prev) =>
      prev.map((c) => (c.id === citation.id ? { ...c, is_verified: newState } : c))
    );
    toast.success(newState ? "מקור אומת!" : "אימות הוסר");
    fetchData();
  };

  const removeVerified = async (id: string) => {
    await supabase.from("verified_sources").delete().eq("id", id);
    setVerifiedSources((prev) => prev.filter((v) => v.id !== id));
    toast.success("מקור מאומת הוסר");
  };

  const filteredCitations = citations.filter(
    (c) =>
      c.raw_input.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.formatted_output.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalCitations = citations.length;
  const verifiedCount = citations.filter((c) => c.is_verified).length;
  const manualCount = totalCitations - verifiedCount;

  // Compute most cited laws
  const lawCounts: Record<string, number> = {};
  citations.forEach((c) => {
    const name = c.raw_input.substring(0, 50);
    lawCounts[name] = (lawCounts[name] || 0) + 1;
  });
  const topLaws = Object.entries(lawCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (authLoading || loadingData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const TABS = [
    { id: "analytics" as const, label: "📊 סטטיסטיקות" },
    { id: "history" as const, label: "📋 היסטוריה" },
    { id: "verified" as const, label: "✅ מקורות מאומתים" },
  ];

  return (
    <div className="min-h-screen bg-background" style={{ direction: "rtl" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card shadow-sm">
        <div className="flex items-center gap-3">
          <div className="text-2xl">🏛</div>
          <div>
            <h1 className="text-foreground text-lg font-bold">פאנל ניהול</h1>
            <p className="text-muted-foreground text-xs">{user?.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg transition-colors"
          >
            ← חזור לאפליקציה
          </button>
          <button
            onClick={() => signOut()}
            className="text-sm text-destructive hover:bg-destructive/10 px-3 py-1.5 rounded-lg transition-colors"
          >
            התנתק
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-muted rounded-lg p-1 mb-6 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`mode-tab ${activeTab === tab.id ? "mode-tab-active" : "mode-tab-inactive"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Analytics Tab */}
        {activeTab === "analytics" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard icon="📄" label="סה״כ אזכורים" value={totalCitations} />
              <StatCard icon="✅" label="מקורות מאומתים" value={verifiedCount} color="text-emerald-600" />
              <StatCard icon="📝" label="מקורות ידניים" value={manualCount} color="text-amber-600" />
            </div>

            {topLaws.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                <h3 className="text-foreground font-bold text-sm mb-4">🏆 מקורות הכי מצוטטים</h3>
                <div className="space-y-2">
                  {topLaws.map(([name, count], i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-border/50 last:border-b-0">
                      <span className="text-sm text-foreground truncate max-w-[70%]">{name}</span>
                      <Badge variant="secondary">{count} פעמים</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === "history" && (
          <div className="space-y-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="חפש באזכורים..."
              className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-foreground text-sm focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />

            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">תאריך</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">קלט</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">פלט</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">סטטוס</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCitations.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-muted-foreground">
                          {citations.length === 0 ? "אין היסטוריה עדיין" : "לא נמצאו תוצאות"}
                        </td>
                      </tr>
                    ) : (
                      filteredCitations.slice(0, 50).map((cit) => (
                        <tr key={cit.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                            {new Date(cit.created_at).toLocaleDateString("he-IL")}
                          </td>
                          <td className="px-4 py-3 text-foreground max-w-[200px] truncate">{cit.raw_input}</td>
                          <td className="px-4 py-3 text-foreground max-w-[300px] truncate">{cit.formatted_output}</td>
                          <td className="px-4 py-3">
                            {cit.is_verified ? (
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">✓ מאומת</Badge>
                            ) : (
                              <Badge variant="secondary">ידני</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => toggleVerification(cit)}
                              className={`text-xs px-2 py-1 rounded transition-colors ${
                                cit.is_verified
                                  ? "text-destructive hover:bg-destructive/10"
                                  : "text-primary hover:bg-primary/10"
                              }`}
                            >
                              {cit.is_verified ? "בטל אימות" : "אמת"}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Verified Sources Tab */}
        {activeTab === "verified" && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם מקור</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">סוג</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">ציטוט מלא</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">אופן אימות</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verifiedSources.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-muted-foreground">
                          אין מקורות מאומתים עדיין
                        </td>
                      </tr>
                    ) : (
                      verifiedSources.map((vs) => (
                        <tr key={vs.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 text-foreground font-medium">{vs.source_name}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline">{vs.source_type}</Badge>
                          </td>
                          <td className="px-4 py-3 text-foreground max-w-[300px] truncate">{vs.full_citation}</td>
                          <td className="px-4 py-3">
                            <Badge className={vs.auto_verified ? "bg-blue-100 text-blue-700 border-blue-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}>
                              {vs.auto_verified ? "אוטומטי" : "ידני"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => removeVerified(vs.id)}
                              className="text-xs text-destructive hover:bg-destructive/10 px-2 py-1 rounded transition-colors"
                            >
                              הסר
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: number; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="text-muted-foreground text-xs">{label}</p>
          <p className={`text-2xl font-bold ${color || "text-foreground"}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

export default Admin;
