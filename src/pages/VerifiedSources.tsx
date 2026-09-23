import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { copyCitationRich } from "@/lib/citationRichText";
import { extractCitationFromResponse } from "@/lib/citationUtils";
import { RenderCitation } from "@/components/admin/RenderCitation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { Copy, ArrowRight, Lock, Search } from "lucide-react";

interface VerifiedSource {
  id: string;
  source_name: string;
  source_type: string;
  full_citation: string;
  year: string | null;
  verified_at: string;
}

const CATEGORIES = [
  { value: "all", label: "הכל" },
  { value: "legislation_primary", label: "חקיקה ראשית" },
  { value: "legislation_secondary", label: "חקיקת משנה" },
  { value: "caselaw", label: "פסיקה" },
  { value: "literature", label: "ספרות ומאמרים" },
  { value: "other", label: "אחר" },
];

export default function VerifiedSources() {
  const { user, isAdmin } = useAuth();
  const { isSubscribed, loading: subLoading } = useSubscription();
  const navigate = useNavigate();
  const [sources, setSources] = useState<VerifiedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");

  const canAccess = isAdmin || isSubscribed;

  useEffect(() => {
    if (!canAccess) return;
    (async () => {
      const { data } = await supabase
        .from("verified_sources")
        .select("id, source_name, source_type, full_citation, year, verified_at")
        .eq("verification_status", "verified")
        .order("verified_at", { ascending: false });
      setSources(data ?? []);
      setLoading(false);
    })();
  }, [canAccess]);

  if (subLoading) return null;

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6 text-center bg-background" dir="rtl">
        <div className="bg-card rounded-2xl border border-border p-10 shadow-sm max-w-md space-y-4">
          <Lock className="h-10 w-10 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-bold text-foreground">מקורות מאומתים זמינים למנויים בלבד</h2>
          <p className="text-muted-foreground text-sm">שדרגו לחשבון מנוי כדי לגשת למאגר המקורות המאומתים שלנו.</p>
          <div className="flex gap-3 justify-center pt-2">
            <Button onClick={() => navigate("/profile?tab=account")} className="bg-primary text-primary-foreground hover:bg-primary/90">שדרוג חשבון</Button>
            <Button variant="ghost" onClick={() => navigate(-1 as any)}>
              <ArrowRight className="h-4 w-4 ml-1" /> חזרה
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const filtered = sources.filter((s) => {
    const matchTab = tab === "all" || s.source_type === tab;
    const q = search.trim().toLowerCase();
    const matchSearch = !q || s.source_name.toLowerCase().includes(q) || s.full_citation.toLowerCase().includes(q);
    return matchTab && matchSearch;
  });

  const cleanCitation = (text: string) => {
    let clean = text.replace(/\s*📐\s*כלל:.*$/gm, "").trim();
    clean = extractCitationFromResponse(clean) || clean;
    return clean;
  };

  const handleCopy = async (citation: string) => {
    await copyCitationRich(cleanCitation(citation));
    toast.success("הציטוט הועתק");
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">📚 מקורות מאומתים</h1>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1 as any)} className="text-muted-foreground hover:text-foreground">
            <ArrowRight className="h-4 w-4 ml-1" /> חזרה
          </Button>
        </div>

        {/* Card container */}
        <div className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-4">
          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="חיפוש לפי שם מקור או ציטוט..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 bg-background border-border"
            />
          </div>

          {/* Category tabs - right aligned */}
          <div className="flex flex-wrap gap-1.5 justify-start">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                onClick={() => setTab(c.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  tab === c.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Table */}
          {loading ? (
            <p className="text-muted-foreground text-sm py-8 text-center">טוען מקורות...</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">לא נמצאו מקורות.</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-right text-foreground font-semibold">שם מקור</TableHead>
                    <TableHead className="text-right text-foreground font-semibold">קטגוריה</TableHead>
                    <TableHead className="text-right text-foreground font-semibold">ציטוט מלא</TableHead>
                    <TableHead className="text-right text-foreground font-semibold w-16">העתק</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-medium text-foreground">{s.source_name}</TableCell>
                      <TableCell>
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent text-accent-foreground">
                          {CATEGORIES.find((c) => c.value === s.source_type)?.label ?? s.source_type}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <span className="cursor-pointer hover:text-foreground transition-colors"><RenderCitation text={cleanCitation(s.full_citation)} /></span>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-96 text-sm whitespace-pre-wrap break-words bg-card border-border" dir="rtl" side="top">
                            <RenderCitation text={cleanCitation(s.full_citation)} />
                          </HoverCardContent>
                        </HoverCard>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleCopy(s.full_citation)} title="העתק ציטוט" className="text-muted-foreground hover:text-primary">
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
