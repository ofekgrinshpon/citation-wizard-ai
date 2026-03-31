import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import AdminHeader from "@/components/admin/AdminHeader";
import StatCard from "@/components/admin/StatCard";
import SourceCategoryView from "@/components/admin/SourceCategoryView";
import UsersTable from "@/components/admin/UsersTable";
import VerifiedSourcesTable, { type VerifiedSourceRow } from "@/components/admin/VerifiedSourcesTable";
import {
  classifyVerifiedSource,
  getVerifiedCategoryLabel,
  ensureVerifiedSources,
  type VerifiedSourceCategory,
} from "@/lib/verifiedSources";

interface CitationRecord {
  id: string;
  raw_input: string;
  formatted_output: string;
  source_type: string | null;
  is_verified: boolean;
  created_at: string;
}

interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
}

type MainTab = "analytics" | "sources" | "users";
type SourceSubTab = "caselaw" | "legislation" | "literature" | "verified";

const Admin = () => {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [verifiedSources, setVerifiedSources] = useState<VerifiedSourceRow[]>([]);
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
    if (!isAdmin) return;
    void fetchData();
  }, [isAdmin]);

  const fetchData = async () => {
    setLoadingData(true);

    const [citRes, usersRes] = await Promise.all([
      supabase.from("citation_history").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
    ]);

    const citationRows = citRes.data ?? [];
    const userRows = usersRes.data ?? [];

    setCitations(citationRows);
    setUsers(userRows);

    const verifiedCitationRows = citationRows
      .filter((citation) => citation.is_verified)
      .map((citation) => ({
        rawInput: citation.raw_input,
        fullCitation: citation.formatted_output,
        sourceType: citation.source_type,
        verifiedBy: user?.id,
        autoVerified: false,
      }));

    if (verifiedCitationRows.length > 0) {
      try {
        await ensureVerifiedSources(verifiedCitationRows);
      } catch {
        toast.error("לא ניתן לסנכרן מקורות מאומתים מההיסטוריה");
      }
    }

    const { data: verifiedRows } = await supabase
      .from("verified_sources")
      .select("*")
      .order("verified_at", { ascending: false });

    setVerifiedSources((verifiedRows ?? []) as unknown as VerifiedSourceRow[]);
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
      try {
        await ensureVerifiedSources([
          {
            rawInput: citation.raw_input,
            fullCitation: citation.formatted_output,
            sourceType: citation.source_type,
            verifiedBy: user?.id,
            autoVerified: false,
          },
        ], { skipAIVerification: true });
      } catch {
        toast.error("לא ניתן לשמור מקור מאומת");
        return;
      }
    } else {
      await supabase.from("verified_sources").delete().eq("full_citation", citation.formatted_output);
    }

    setCitations((prev) => prev.map((item) => (item.id === citation.id ? { ...item, is_verified: newState } : item)));
    toast.success(newState ? "מקור אומת!" : "אימות הוסר");
    void fetchData();
  };

  const editVerified = async (
    source: VerifiedSourceRow,
    updates: { source_name: string; full_citation: string; verification_status: string }
  ) => {
    const searchText = `${updates.source_name} ${updates.full_citation}`.toLowerCase();
    const { error } = await supabase
      .from("verified_sources")
      .update({
        source_name: updates.source_name,
        full_citation: updates.full_citation,
        verification_status: updates.verification_status,
        search_text: searchText,
      })
      .eq("id", source.id);

    if (error) {
      toast.error("שגיאה בעדכון מקור");
      return;
    }

    toast.success("מקור עודכן בהצלחה!");
    void fetchData();
  };

  const removeVerified = async (source: VerifiedSourceRow) => {
    const [{ error: deleteError }, { error: historyError }] = await Promise.all([
      supabase.from("verified_sources").delete().eq("id", source.id),
      supabase.from("citation_history").update({ is_verified: false }).eq("formatted_output", source.full_citation),
    ]);

    if (deleteError || historyError) {
      toast.error("שגיאה בהסרת מקור מאומת");
      return;
    }

    setVerifiedSources((prev) => prev.filter((item) => item.id !== source.id));
    setCitations((prev) =>
      prev.map((item) =>
        item.formatted_output === source.full_citation ? { ...item, is_verified: false } : item
      )
    );
    toast.success("מקור מאומת הוסר");
  };

  const caselawCitations = useMemo(
    () =>
      citations.filter(
        (citation) =>
          classifyVerifiedSource({
            rawInput: citation.raw_input,
            fullCitation: citation.formatted_output,
            sourceType: citation.source_type,
          }) === "caselaw"
      ),
    [citations]
  );

  const legislationCitations = useMemo(
    () =>
      citations.filter((citation) => {
        const category = classifyVerifiedSource({
          rawInput: citation.raw_input,
          fullCitation: citation.formatted_output,
          sourceType: citation.source_type,
        });
        return category === "legislation_primary" || category === "legislation_secondary";
      }),
    [citations]
  );

  const literatureCitations = useMemo(
    () =>
      citations.filter(
        (citation) =>
          classifyVerifiedSource({
            rawInput: citation.raw_input,
            fullCitation: citation.formatted_output,
            sourceType: citation.source_type,
          }) === "literature"
      ),
    [citations]
  );

  const verifiedByCategory = useMemo(() => {
    const grouped: Record<VerifiedSourceCategory, VerifiedSourceRow[]> = {
      caselaw: [],
      legislation_primary: [],
      legislation_secondary: [],
      literature: [],
    };

    verifiedSources.forEach((source) => {
      const category = classifyVerifiedSource({
        rawInput: source.source_name,
        fullCitation: source.full_citation,
        sourceType: source.source_type,
      });
      grouped[category].push(source);
    });

    return grouped;
  }, [verifiedSources]);

  const totalCitations = citations.length;
  const verifiedCount = verifiedSources.length;

  const lawCounts: Record<string, number> = {};
  citations.forEach((citation) => {
    const name = citation.raw_input.substring(0, 50);
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

  const mainTabs = [
    { id: "analytics" as const, label: "📊 סטטיסטיקות" },
    { id: "sources" as const, label: "📚 ניהול מקורות" },
    { id: "users" as const, label: "👥 משתמשים" },
  ];

  const sourceSubTabs = [
    { id: "caselaw" as const, label: "⚖️ פסיקה", count: caselawCitations.length },
    { id: "legislation" as const, label: "📜 חקיקה", count: legislationCitations.length },
    { id: "literature" as const, label: "📖 ספרות ומאמרים", count: literatureCitations.length },
    { id: "verified" as const, label: "✅ מקורות מאומתים", count: verifiedSources.length },
  ];

  return (
    <div className="min-h-screen bg-background" style={{ direction: "rtl" }}>
      <AdminHeader email={user?.email} onSignOut={signOut} />

      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex gap-1 bg-muted rounded-lg p-1 mb-6 w-fit">
          {mainTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`mode-tab ${activeTab === tab.id ? "mode-tab-active" : "mode-tab-inactive"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "analytics" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard icon="📄" label="סה״כ אזכורים" value={totalCitations} />
              <StatCard icon="✅" label="מקורות מאומתים" value={verifiedCount} color="text-primary" />
              <StatCard icon="⚖️" label="פסיקה" value={caselawCitations.length} />
              <StatCard icon="📜" label="חקיקה" value={legislationCitations.length} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard icon="📖" label="ספרות" value={literatureCitations.length} />
              <StatCard icon="👥" label="משתמשים רשומים" value={users.length} color="text-primary" />
              <StatCard icon="🗃️" label="מקורות מאומתים במאגר" value={verifiedSources.length} color="text-primary" />
            </div>

            {topLaws.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                <h3 className="text-foreground font-bold text-sm mb-4">🏆 מקורות הכי מצוטטים</h3>
                <div className="space-y-2">
                  {topLaws.map(([name, count], index) => (
                    <div key={index} className="flex items-center justify-between py-2 border-b border-border/50 last:border-b-0">
                      <span className="text-sm text-foreground truncate max-w-[70%]">{name}</span>
                      <Badge variant="secondary">{count} פעמים</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "sources" && (
          <div className="space-y-6">
            <div className="flex gap-2 flex-wrap">
              {sourceSubTabs.map((tab) => (
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
              <SourceCategoryView title="⚖️ פסיקה (Case Law)" sources={caselawCitations} onToggleVerification={toggleVerification} />
            )}

            {sourceSubTab === "legislation" && (
              <div className="space-y-8">
                <SourceCategoryView
                  title="📜 חקיקה ראשית (Primary Legislation)"
                  sources={legislationCitations.filter((citation) =>
                    classifyVerifiedSource({
                      rawInput: citation.raw_input,
                      fullCitation: citation.formatted_output,
                      sourceType: citation.source_type,
                    }) === "legislation_primary"
                  )}
                  onToggleVerification={toggleVerification}
                />
                <SourceCategoryView
                  title="📋 חקיקת משנה (Secondary Legislation)"
                  sources={legislationCitations.filter((citation) =>
                    classifyVerifiedSource({
                      rawInput: citation.raw_input,
                      fullCitation: citation.formatted_output,
                      sourceType: citation.source_type,
                    }) === "legislation_secondary"
                  )}
                  onToggleVerification={toggleVerification}
                />
              </div>
            )}

            {sourceSubTab === "literature" && (
              <SourceCategoryView title="📖 ספרות ומאמרים (Literature)" sources={literatureCitations} onToggleVerification={toggleVerification} />
            )}

            {sourceSubTab === "verified" && (
              <div className="space-y-8">
                <VerifiedSourcesTable
                  title={`⚖️ ${getVerifiedCategoryLabel("caselaw")}`}
                  category="caselaw"
                  sources={verifiedByCategory.caselaw}
                  onRemove={removeVerified}
                  onEdit={editVerified}
                />
                <VerifiedSourcesTable
                  title={`📜 ${getVerifiedCategoryLabel("legislation_primary")}`}
                  category="legislation_primary"
                  sources={verifiedByCategory.legislation_primary}
                  onRemove={removeVerified}
                  onEdit={editVerified}
                />
                <VerifiedSourcesTable
                  title={`📋 ${getVerifiedCategoryLabel("legislation_secondary")}`}
                  category="legislation_secondary"
                  sources={verifiedByCategory.legislation_secondary}
                  onRemove={removeVerified}
                  onEdit={editVerified}
                />
                <VerifiedSourcesTable
                  title={`📖 ${getVerifiedCategoryLabel("literature")}`}
                  category="literature"
                  sources={verifiedByCategory.literature}
                  onRemove={removeVerified}
                  onEdit={editVerified}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "users" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StatCard icon="👥" label="סה״כ משתמשים רשומים" value={users.length} color="text-primary" />
              <StatCard
                icon="📅"
                label="הצטרפו החודש"
                value={users.filter((profile) => {
                  const createdAt = new Date(profile.created_at);
                  const now = new Date();
                  return createdAt.getMonth() === now.getMonth() && createdAt.getFullYear() === now.getFullYear();
                }).length}
                color="text-primary"
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
