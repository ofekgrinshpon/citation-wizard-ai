import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import AddVerifiedSourceDialog from "@/components/admin/AddVerifiedSourceDialog";
import LegalDocumentIngestion from "@/components/admin/LegalDocumentIngestion";
import ApifyIngestionPanel from "@/components/admin/ApifyIngestionPanel";
import BatchEmbeddingPanel from "@/components/admin/BatchEmbeddingPanel";
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
  is_subscribed?: boolean;
  citation_count?: number;
  plan?: string;
  included_credits_remaining?: number;
  topup_credits_remaining?: number;
  referral_code?: string | null;
  referred_by_user_id?: string | null;
}

export interface UserUsage {
  spent: number;
  lastChargeAt: string | null;
  lastActivityAt: string | null;
}

type MainTab = "analytics" | "sources" | "users" | "knowledge";
type SourceSubTab = "caselaw" | "legislation" | "literature" | "other" | "verified";

const Admin = () => {
  const { user, isAdmin, isAdminResolved, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [verifiedSources, setVerifiedSources] = useState<VerifiedSourceRow[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userUsage, setUserUsage] = useState<Record<string, UserUsage>>({});
  const [adminUserIds, setAdminUserIds] = useState<Set<string>>(new Set());
  const [usersRefreshedAt, setUsersRefreshedAt] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>("analytics");
  const [sourceSubTab, setSourceSubTab] = useState<SourceSubTab>("caselaw");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [legalDocs, setLegalDocs] = useState<{ id: string; title: string; source_type: string; citation: string; created_at: string }[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [totalDocsCount, setTotalDocsCount] = useState(0);
  const [docTypeCounts, setDocTypeCounts] = useState<Record<string, number>>({});
  const [qaStats, setQaStats] = useState<{ total: number; withLocal: number; perplexityOnly: number; avgLocalRatio: number }>({ total: 0, withLocal: 0, perplexityOnly: 0, avgLocalRatio: 0 });

  // Per-tab loading states — shell renders immediately, tabs load lazily
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [knowledgeLoaded, setKnowledgeLoaded] = useState(false);

  // Track if admin was ever confirmed
  const [adminConfirmed, setAdminConfirmed] = useState(false);

  useEffect(() => {
    if (isAdmin) setAdminConfirmed(true);
  }, [isAdmin]);

  useEffect(() => {
    // Wait for both auth and role resolution before redirecting away
    if (authLoading || !isAdminResolved) return;
    if (!user && !adminConfirmed) {
      navigate("/");
    }
    if (user && isAdmin === false && !adminConfirmed) {
      navigate("/");
    }
  }, [user, isAdmin, isAdminResolved, authLoading, adminConfirmed, navigate]);

  // --- Lazy tab-specific data fetchers ---

  const fetchAnalytics = useCallback(async () => {
    if (analyticsLoaded) return;
    try {
      const [citRes, verifiedRes] = await Promise.all([
        supabase.from("citation_history").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("verified_sources").select("*").order("verified_at", { ascending: false }),
      ]);
      setCitations(citRes.data ?? []);
      setVerifiedSources((verifiedRes.data ?? []) as unknown as VerifiedSourceRow[]);
      setAnalyticsLoaded(true);
    } catch (err) {
      console.error("[Admin] fetchAnalytics failed:", err);
    }
  }, [analyticsLoaded]);

  const fetchSources = useCallback(async () => {
    if (sourcesLoaded) return;
    // Sources tab reuses citations + verifiedSources, ensure analytics is loaded
    if (!analyticsLoaded) await fetchAnalytics();
    setSourcesLoaded(true);
  }, [sourcesLoaded, analyticsLoaded, fetchAnalytics]);

  const fetchUsers = useCallback(async (force = false) => {
    if (usersLoaded && !force) return;
    try {
      const [profilesRes, rolesRes, ledgerRes, citRes, qaRes] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role").eq("role", "admin"),
        supabase
          .from("credit_ledger")
          .select("user_id, event_type, amount, created_at")
          .in("event_type", ["consume", "refund"])
          .order("created_at", { ascending: false })
          .limit(5000),
        supabase
          .from("citation_history")
          .select("user_id, created_at")
          .order("created_at", { ascending: false })
          .limit(3000),
        supabase
          .from("qa_logs")
          .select("user_id, created_at")
          .order("created_at", { ascending: false })
          .limit(3000),
      ]);

      const usage: Record<string, UserUsage> = {};
      const bump = (id: string | null | undefined): UserUsage | null => {
        if (!id) return null;
        usage[id] ??= { spent: 0, lastChargeAt: null, lastActivityAt: null };
        return usage[id];
      };

      for (const row of ledgerRes.data ?? []) {
        const u = bump(row.user_id);
        if (!u) continue;
        // consume rows store a negative amount; refunds store the positive mirror
        u.spent += -(row.amount ?? 0);
        if (row.event_type === "consume" && !u.lastChargeAt) u.lastChargeAt = row.created_at;
      }
      for (const row of [...(citRes.data ?? []), ...(qaRes.data ?? [])]) {
        const u = bump(row.user_id);
        if (!u) continue;
        if (!u.lastActivityAt || row.created_at > u.lastActivityAt) u.lastActivityAt = row.created_at;
      }

      setUserUsage(usage);
      setAdminUserIds(new Set((rolesRes.data ?? []).map((r) => r.user_id)));
      setUsers(profilesRes.data ?? []);
      setUsersRefreshedAt(new Date());
      setUsersLoaded(true);
    } catch (err) {
      console.error("[Admin] fetchUsers failed:", err);
    }
  }, [usersLoaded]);


  const fetchKnowledge = useCallback(async () => {
    if (knowledgeLoaded) return;
    try {
      // Only fetch lightweight data first — defer qa_logs until explicitly needed
      const [docsRes, chunksRes, totalDocsRes] = await Promise.all([
        supabase.from("legal_documents").select("id, title, source_type, citation, created_at").order("created_at", { ascending: false }).limit(50),
        supabase.from("legal_document_chunks").select("id", { count: "estimated", head: true }),
        supabase.from("legal_documents").select("id", { count: "estimated", head: true }),
      ]);

      setLegalDocs(docsRes.data ?? []);
      setTotalChunks(chunksRes.count ?? 0);
      setTotalDocsCount(totalDocsRes.count ?? 0);

      // Build type counts from the already-fetched recent 50 docs (approximate)
      const typeCountsMap: Record<string, number> = {};
      (docsRes.data ?? []).forEach((d: { source_type: string }) => {
        typeCountsMap[d.source_type] = (typeCountsMap[d.source_type] || 0) + 1;
      });
      setDocTypeCounts(typeCountsMap);

      setKnowledgeLoaded(true);

      // Fetch QA stats in background — don't block the tab
      Promise.resolve(
        supabase.from("qa_logs").select("local_footnotes_count, perplexity_footnotes_count, total_footnotes").order("created_at", { ascending: false }).limit(500)
      ).then(({ data: qaLogsData }) => {
          const qaLogs = (qaLogsData ?? []) as Array<{ local_footnotes_count: number; perplexity_footnotes_count: number; total_footnotes: number }>;
          const totalQ = qaLogs.length;
          const withLocal = qaLogs.filter(l => l.local_footnotes_count > 0).length;
          const perplexityOnly = qaLogs.filter(l => l.local_footnotes_count === 0 && l.perplexity_footnotes_count > 0).length;
          const avgLocalRatio = totalQ > 0
            ? qaLogs.reduce((sum, l) => sum + (l.total_footnotes > 0 ? l.local_footnotes_count / l.total_footnotes : 0), 0) / totalQ * 100
            : 0;
          setQaStats({ total: totalQ, withLocal, perplexityOnly, avgLocalRatio: Math.round(avgLocalRatio) });
        })
        .catch(err => console.error("[Admin] QA stats background fetch failed:", err));
    } catch (err) {
      console.error("[Admin] fetchKnowledge failed:", err);
      // Still mark as loaded so the tab renders instead of spinning forever
      setKnowledgeLoaded(true);
    }
  }, [knowledgeLoaded]);

  // Fetch data for active tab when admin is confirmed
  useEffect(() => {
    if (!isAdmin) return;
    switch (activeTab) {
      case "analytics": void fetchAnalytics(); break;
      case "sources": void fetchSources(); break;
      case "users": void fetchUsers(); break;
      case "knowledge": void fetchKnowledge(); break;
    }
  }, [isAdmin, activeTab, fetchAnalytics, fetchSources, fetchUsers, fetchKnowledge]);

  // Reload all loaded tabs
  const reloadAll = useCallback(async () => {
    setAnalyticsLoaded(false);
    setSourcesLoaded(false);
    setUsersLoaded(false);
    setKnowledgeLoaded(false);
  }, []);

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
    void reloadAll();
  };

  const bulkToggleVerification = async (citationsToToggle: CitationRecord[]) => {
    const toVerify = citationsToToggle.filter((c) => !c.is_verified);
    const toUnverify = citationsToToggle.filter((c) => c.is_verified);

    if (toVerify.length > 0) {
      const ids = toVerify.map((c) => c.id);
      await supabase.from("citation_history").update({ is_verified: true }).in("id", ids);
      try {
        await ensureVerifiedSources(
          toVerify.map((c) => ({
            rawInput: c.raw_input,
            fullCitation: c.formatted_output,
            sourceType: c.source_type,
            verifiedBy: user?.id,
            autoVerified: false,
          })),
          { skipAIVerification: true }
        );
      } catch {
        toast.error("שגיאה בסנכרון מקורות מאומתים");
      }
    }

    if (toUnverify.length > 0) {
      const ids = toUnverify.map((c) => c.id);
      await supabase.from("citation_history").update({ is_verified: false }).in("id", ids);
      for (const c of toUnverify) {
        await supabase.from("verified_sources").delete().eq("full_citation", c.formatted_output);
      }
    }

    toast.success(`${citationsToToggle.length} מקורות עודכנו`);
    void reloadAll();
  };

  const bulkVerifyVerifiedSources = async (sourceIds: string[]) => {
    const { error } = await supabase
      .from("verified_sources")
      .update({ verification_status: "verified" })
      .in("id", sourceIds);

    if (error) {
      toast.error("שגיאה באימות מקורות");
      return;
    }
    toast.success(`${sourceIds.length} מקורות אומתו`);
    void reloadAll();
  };

  const bulkRemoveVerifiedSources = async (sourceIds: string[]) => {
    const { error } = await supabase
      .from("verified_sources")
      .delete()
      .in("id", sourceIds);

    if (error) {
      toast.error("שגיאה בהסרת מקורות");
      return;
    }
    toast.success(`${sourceIds.length} מקורות הוסרו`);
    void reloadAll();
  };

  const verifySingleSource = async (source: VerifiedSourceRow) => {
    await bulkVerifyVerifiedSources([source.id]);
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
    void reloadAll();
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

  const otherCitations = useMemo(
    () =>
      citations.filter(
        (citation) =>
          classifyVerifiedSource({
            rawInput: citation.raw_input,
            fullCitation: citation.formatted_output,
            sourceType: citation.source_type,
          }) === "other"
      ),
    [citations]
  );

  const verifiedByCategory = useMemo(() => {
    const grouped: Record<VerifiedSourceCategory, VerifiedSourceRow[]> = {
      caselaw: [],
      legislation_primary: [],
      legislation_secondary: [],
      literature: [],
      other: [],
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

  // Show shell immediately once auth is resolved — don't wait for data
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const isTabLoading = (tab: MainTab) => {
    switch (tab) {
      case "analytics": return !analyticsLoaded;
      case "sources": return !sourcesLoaded;
      case "users": return !usersLoaded;
      case "knowledge": return !knowledgeLoaded;
    }
  };

  const TabSpinner = () => (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  const mainTabs = [
    { id: "analytics" as const, label: "📊 סטטיסטיקות" },
    { id: "sources" as const, label: "📚 ניהול מקורות" },
    { id: "knowledge" as const, label: "🧠 מאגר ידע" },
    { id: "users" as const, label: "👥 משתמשים" },
  ];

  const sourceSubTabs = [
    { id: "caselaw" as const, label: "⚖️ פסיקה", count: caselawCitations.length },
    { id: "legislation" as const, label: "📜 חקיקה", count: legislationCitations.length },
    { id: "literature" as const, label: "📖 ספרות ומאמרים", count: literatureCitations.length },
    { id: "other" as const, label: "📁 אחר", count: otherCitations.length },
    { id: "verified" as const, label: "✅ מקורות מאומתים", count: verifiedSources.length },
  ];

  return (
    <div className="min-h-screen bg-background" style={{ direction: "rtl" }}>
      <AdminHeader email={user?.email} onSignOut={async () => { await signOut(); window.location.href = "/"; }} />

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
          isTabLoading("analytics") ? <TabSpinner /> : (
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
          )
        )}

        {activeTab === "sources" && (
          isTabLoading("sources") ? <TabSpinner /> : (
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
              <SourceCategoryView title="⚖️ פסיקה (Case Law)" sources={caselawCitations} onToggleVerification={toggleVerification} onBulkVerify={bulkToggleVerification} />
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
                  onBulkVerify={bulkToggleVerification}
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
                  onBulkVerify={bulkToggleVerification}
                />
              </div>
            )}

            {sourceSubTab === "literature" && (
              <SourceCategoryView title="📖 ספרות ומאמרים (Literature)" sources={literatureCitations} onToggleVerification={toggleVerification} onBulkVerify={bulkToggleVerification} />
            )}

            {sourceSubTab === "other" && (
              <SourceCategoryView title="📁 אחר (Other)" sources={otherCitations} onToggleVerification={toggleVerification} onBulkVerify={bulkToggleVerification} />
            )}

            {sourceSubTab === "verified" && (
              <div className="space-y-8">
                <div className="flex justify-end">
                  <Button onClick={() => setShowAddDialog(true)}>➕ הוסף מקור חדש</Button>
                </div>
                <AddVerifiedSourceDialog
                  open={showAddDialog}
                  onOpenChange={setShowAddDialog}
                  onAdded={() => reloadAll()}
                  userId={user?.id}
                />
                <VerifiedSourcesTable
                  title={`⚖️ ${getVerifiedCategoryLabel("caselaw")}`}
                  category="caselaw"
                  sources={verifiedByCategory.caselaw}
                  onRemove={removeVerified}
                  onEdit={editVerified}
                  onVerify={verifySingleSource}
                  onBulkVerify={bulkVerifyVerifiedSources}
                  onBulkRemove={bulkRemoveVerifiedSources}
                />
                <VerifiedSourcesTable
                  title={`📜 ${getVerifiedCategoryLabel("legislation_primary")}`}
                  category="legislation_primary"
                  sources={verifiedByCategory.legislation_primary}
                  onRemove={removeVerified}
                  onEdit={editVerified}
                  onVerify={verifySingleSource}
                  onBulkVerify={bulkVerifyVerifiedSources}
                  onBulkRemove={bulkRemoveVerifiedSources}
                />
                <VerifiedSourcesTable
                  title={`📋 ${getVerifiedCategoryLabel("legislation_secondary")}`}
                  category="legislation_secondary"
                  sources={verifiedByCategory.legislation_secondary}
                  onRemove={removeVerified}
                  onEdit={editVerified}
                  onVerify={verifySingleSource}
                  onBulkVerify={bulkVerifyVerifiedSources}
                  onBulkRemove={bulkRemoveVerifiedSources}
                />
                <VerifiedSourcesTable
                  title={`📖 ${getVerifiedCategoryLabel("literature")}`}
                  category="literature"
                  sources={verifiedByCategory.literature}
                  onRemove={removeVerified}
                  onEdit={editVerified}
                  onVerify={verifySingleSource}
                  onBulkVerify={bulkVerifyVerifiedSources}
                  onBulkRemove={bulkRemoveVerifiedSources}
                />
                <VerifiedSourcesTable
                  title={`📁 ${getVerifiedCategoryLabel("other")}`}
                  category="other"
                  sources={verifiedByCategory.other}
                  onRemove={removeVerified}
                  onEdit={editVerified}
                  onVerify={verifySingleSource}
                  onBulkVerify={bulkVerifyVerifiedSources}
                  onBulkRemove={bulkRemoveVerifiedSources}
                />
              </div>
            )}
          </div>
          )
        )}

        {activeTab === "knowledge" && (
          isTabLoading("knowledge") ? <TabSpinner /> : (
          <div className="space-y-6">
            <h2 className="text-foreground font-bold text-lg">🧠 מאגר ידע משפטי (V2 RAG)</h2>
            <p className="text-muted-foreground text-sm">
              הוסיפו מקורות משפטיים למאגר הידע המקומי. מקורות אלו ישמשו כמקור ראשוני בתשובות לשאלות משפטיות.
            </p>

            <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="text-foreground font-bold text-sm">📊 מקורות תשובות (Local vs Perplexity)</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon="❓" label="סה״כ שאלות" value={qaStats.total} />
                <StatCard icon="🟢" label="כוללות מקור מקומי" value={qaStats.withLocal} color="text-primary" />
                <StatCard icon="🔴" label="Perplexity בלבד" value={qaStats.perplexityOnly} color="text-destructive" />
                <StatCard icon="📈" label="% מקורות מקומיים (ממוצע)" value={qaStats.avgLocalRatio} color="text-primary" />
              </div>
              {qaStats.total > 0 && (
                <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full transition-all"
                    style={{ width: `${qaStats.total > 0 ? (qaStats.withLocal / qaStats.total) * 100 : 0}%` }}
                  />
                </div>
              )}
              {qaStats.total > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  {Math.round((qaStats.withLocal / qaStats.total) * 100)}% מהתשובות כוללות לפחות מקור מקומי אחד
                </p>
              )}
            </div>

            {(() => {
              const SOURCE_TYPE_META: Record<string, { emoji: string; label: string }> = {
                legislation: { emoji: "📜", label: "חקיקה" },
                israeli_law: { emoji: "🇮🇱", label: "חקיקה ישראלית" },
                caselaw: { emoji: "⚖️", label: "פסיקה" },
                book: { emoji: "📕", label: "ספרים" },
                article: { emoji: "📰", label: "מאמרים" },
                notebook: { emoji: "📓", label: "מחברות" },
                knesset_research: { emoji: "🏛️", label: "מחקר כנסת" },
                journal_article: { emoji: "📚", label: "מאמר אקדמי" },
                international: { emoji: "🌐", label: "בינלאומי" },
              };
              const typeEntries = Object.entries(docTypeCounts).sort((a, b) => b[1] - a[1]);

              return (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon="📚" label="סה״כ מסמכים" value={totalDocsCount} color="text-primary" />
                    <StatCard icon="🧩" label="סה״כ קטעים (chunks)" value={totalChunks} />
                    {typeEntries.map(([type, count]) => {
                      const meta = SOURCE_TYPE_META[type] || { emoji: "📁", label: type };
                      return <StatCard key={type} icon={meta.emoji} label={meta.label} value={count} />;
                    })}
                  </div>

                  {legalDocs.length > 0 && (
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                      <h3 className="text-foreground font-bold text-sm mb-4">📄 מסמכים אחרונים שנוספו</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-muted-foreground">
                              <th className="py-2 px-2 text-right font-medium">סוג</th>
                              <th className="py-2 px-2 text-right font-medium">כותרת</th>
                              <th className="py-2 px-2 text-right font-medium">אזכור</th>
                              <th className="py-2 px-2 text-right font-medium">תאריך הוספה</th>
                            </tr>
                          </thead>
                          <tbody>
                            {legalDocs.slice(0, 20).map((doc) => {
                              const meta = SOURCE_TYPE_META[doc.source_type] || { emoji: "📁", label: doc.source_type };
                              return (
                                <tr key={doc.id} className="border-b border-border/50 last:border-b-0">
                                  <td className="py-2 px-2 whitespace-nowrap">{meta.emoji} {meta.label}</td>
                                  <td className="py-2 px-2 max-w-[200px] truncate">{doc.title}</td>
                                  <td className="py-2 px-2 max-w-[250px] truncate text-muted-foreground">{doc.citation}</td>
                                  <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">
                                    {new Date(doc.created_at).toLocaleDateString("he-IL")}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            <BatchEmbeddingPanel />
            <LegalDocumentIngestion onIngested={() => reloadAll()} />
            <ApifyIngestionPanel onIngested={() => reloadAll()} />
          </div>
          )
        )}

        {activeTab === "users" && (
          isTabLoading("users") ? <TabSpinner /> : (
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
            <UsersTable
              users={users}
              onUserUpdated={(userId, patch) => {
                setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, ...patch } : u));
              }}
            />
          </div>
          )
        )}
      </div>
    </div>
  );
};

export default Admin;
