import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import AdminHeader from "@/components/admin/AdminHeader";
import StatCard from "@/components/admin/StatCard";
import SourceCategoryView from "@/components/admin/SourceCategoryView";
import UsersTable from "@/components/admin/UsersTable";

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

interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
}

// Classification helpers
const LEGISLATION_PATTERNS = /^(חוק|פקודת|פקודה|תקנות|צו|כללי|הוראות|נוהל|תקנון|חוק[\s-]יסוד)/;
const CASELAW_PATTERNS = /^(בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|ת"א|ת״א|ע"ע|ע״ע|עע"מ|עע״מ|בש"פ|בש״פ|ת"פ|ת״פ|תפ"ח|תפ״ח|עמ"ה|עמ״ה|בר"ם|בר״ם)/;
const SECONDARY_LEGISLATION = /^(תקנות|צו|כללי|הוראות|נוהל|תקנון)/;

function classifySource(text: string): "caselaw" | "legislation_primary" | "legislation_secondary" | "literature" {
  const trimmed = text.trim();
  if (CASELAW_PATTERNS.test(trimmed)) return "caselaw";
  if (LEGISLATION_PATTERNS.test(trimmed)) {
    return SECONDARY_LEGISLATION.test(trimmed) ? "legislation_secondary" : "legislation_primary";
  }
  return "literature";
}

function classifyCitationRecord(cit: CitationRecord): "caselaw" | "legislation_primary" | "legislation_secondary" | "literature" {
  // Check both raw_input and formatted_output
  const fromInput = classifySource(cit.raw_input);
  if (fromInput !== "literature") return fromInput;
  return classifySource(cit.formatted_output);
}

type MainTab = "analytics" | "sources" | "users";
type SourceSubTab = "caselaw" | "legislation" | "literature" | "verified";

const Admin = () => {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [verifiedSources, setVerifiedSources] = useState<VerifiedSource[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [activeTab, setActiveTab] = useState<MainTab>("analytics");
  const [sourceSubTab, setSourceSubTab] = useState<SourceSubTab>("caselaw");

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
    const [citRes, verRes, usersRes] = await Promise.all([
      supabase.from("citation_history").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("verified_sources").select("*").order("verified_at", { ascending: false }),
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
    ]);
    if (citRes.data) setCitations(citRes.data);
    if (verRes.data) setVerifiedSources(verRes.data);
    if (usersRes.data) setUsers(usersRes.data);
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
      const cat = classifyCitationRecord(citation);
      const sourceType = cat === "caselaw" ? "caselaw" : cat.startsWith("legislation") ? cat : "literature";
      await supabase.from("verified_sources").insert({
        source_name: citation.raw_input.substring(0, 100),
        source_type: sourceType,
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

  // Categorize citations
  const caselawCitations = citations.filter((c) => classifyCitationRecord(c) === "caselaw");
  const legislationCitations = citations.filter((c) => {
    const cat = classifyCitationRecord(c);
    return cat === "legislation_primary" || cat === "legislation_secondary";
  });
  const literatureCitations = citations.filter((c) => classifyCitationRecord(c) === "literature");

  const totalCitations = citations.length;
  const verifiedCount = citations.filter((c) => c.is_verified).length;

  // Top laws
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

  const MAIN_TABS = [
    { id: "analytics" as const, label: "📊 סטטיסטיקות" },
    { id: "sources" as const, label: "📚 ניהול מקורות" },
    { id: "users" as const, label: "👥 משתמשים" },
  ];

  const SOURCE_SUB_TABS = [
    { id: "caselaw" as const, label: "⚖️ פסיקה", count: caselawCitations.length },
    { id: "legislation" as const, label: "📜 חקיקה", count: legislationCitations.length },
    { id: "literature" as const, label: "📖 ספרות ומאמרים", count: literatureCitations.length },
    { id: "verified" as const, label: "✅ מקורות מאומתים", count: verifiedSources.length },
  ];

  return (
    <div className="min-h-screen bg-background" style={{ direction: "rtl" }}>
      <AdminHeader email={user?.email} onSignOut={signOut} />

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Main Tabs */}
        <div className="flex gap-1 bg-muted rounded-lg p-1 mb-6 w-fit">
          {MAIN_TABS.map((tab) => (
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard icon="📄" label="סה״כ אזכורים" value={totalCitations} />
              <StatCard icon="✅" label="מקורות מאומתים" value={verifiedCount} color="text-blue-600" />
              <StatCard icon="⚖️" label="פסיקה" value={caselawCitations.length} />
              <StatCard icon="📜" label="חקיקה" value={legislationCitations.length} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard icon="📖" label="ספרות" value={literatureCitations.length} />
              <StatCard icon="👥" label="משתמשים רשומים" value={users.length} color="text-primary" />
              <StatCard icon="🗃️" label="מקורות מאומתים במאגר" value={verifiedSources.length} color="text-blue-600" />
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

        {/* Sources Tab */}
        {activeTab === "sources" && (
          <div className="space-y-6">
            {/* Sub-tabs */}
            <div className="flex gap-2 flex-wrap">
              {SOURCE_SUB_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSourceSubTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    sourceSubTab === tab.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    sourceSubTab === tab.id ? "bg-primary-foreground/20" : "bg-background"
                  }`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {sourceSubTab === "caselaw" && (
              <SourceCategoryView
                title="⚖️ פסיקה (Case Law)"
                sources={caselawCitations}
                onToggleVerification={toggleVerification}
              />
            )}

            {sourceSubTab === "legislation" && (
              <div className="space-y-8">
                <SourceCategoryView
                  title="📜 חקיקה ראשית (Primary Legislation)"
                  sources={legislationCitations.filter((c) => classifyCitationRecord(c) === "legislation_primary")}
                  onToggleVerification={toggleVerification}
                />
                <SourceCategoryView
                  title="📋 חקיקה משנית (Secondary Legislation)"
                  sources={legislationCitations.filter((c) => classifyCitationRecord(c) === "legislation_secondary")}
                  onToggleVerification={toggleVerification}
                />
              </div>
            )}

            {sourceSubTab === "literature" && (
              <SourceCategoryView
                title="📖 ספרות ומאמרים (Literature)"
                sources={literatureCitations}
                onToggleVerification={toggleVerification}
              />
            )}

            {sourceSubTab === "verified" && (
              <div className="space-y-4">
                <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם מקור</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">סוג</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">ציטוט מלא</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">שימושים</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">אופן אימות</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">פעולות</th>
                        </tr>
                      </thead>
                      <tbody>
                        {verifiedSources.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="text-center py-8 text-muted-foreground">
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
                                <Badge variant="secondary">{vs.usage_count} פעמים</Badge>
                              </td>
                              <td className="px-4 py-3">
                                <Badge className={vs.auto_verified
                                  ? "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300"
                                  : "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300"
                                }>
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
        )}

        {/* Users Tab */}
        {activeTab === "users" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StatCard icon="👥" label="סה״כ משתמשים רשומים" value={users.length} color="text-primary" />
              <StatCard
                icon="📅"
                label="הצטרפו החודש"
                value={users.filter((u) => {
                  const d = new Date(u.created_at);
                  const now = new Date();
                  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                }).length}
                color="text-emerald-600"
              />
            </div>
            <h3 className="text-foreground font-bold text-base">רשימת משתמשים</h3>
            <UsersTable users={users} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Admin;
