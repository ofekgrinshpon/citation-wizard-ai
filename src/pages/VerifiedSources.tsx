import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { copyPlainText } from "@/lib/clipboard";
import { extractCitationFromResponse } from "@/lib/citationUtils";
import { RenderCitation } from "@/components/admin/RenderCitation";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { Copy, ArrowRight, Lock } from "lucide-react";

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
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6 text-center" dir="rtl">
        <Lock className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-bold">מקורות מאומתים זמינים למנויים בלבד</h2>
        <p className="text-muted-foreground max-w-md">שדרגו לחשבון מנוי כדי לגשת למאגר המקורות המאומתים שלנו.</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate("/profile?tab=account")}>שדרוג חשבון</Button>
          <Button variant="ghost" onClick={() => navigate(-1 as any)}>
            <ArrowRight className="h-4 w-4 ml-1" /> חזרה
          </Button>
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

  const handleCopy = async (citation: string) => {
    // Strip inline rule references like "📐 כלל: 2 – ..."
    let clean = citation.replace(/\s*📐\s*כלל:.*$/gm, "").trim();
    clean = extractCitationFromResponse(clean) || clean;
    await copyPlainText(clean);
    toast.success("הציטוט הועתק");
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">📚 מקורות מאומתים</h1>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1 as any)}>
            <ArrowRight className="h-4 w-4 ml-1" /> חזרה
          </Button>
        </div>

        <Input
          placeholder="חיפוש לפי שם מקור או ציטוט..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap justify-end">
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c.value} value={c.value}>{c.label}</TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            {loading ? (
              <p className="text-muted-foreground text-sm">טוען מקורות...</p>
            ) : filtered.length === 0 ? (
              <p className="text-muted-foreground text-sm">לא נמצאו מקורות.</p>
            ) : (
              <div dir="rtl"><Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">שם מקור</TableHead>
                    <TableHead className="text-right">קטגוריה</TableHead>
                    <TableHead className="text-right">ציטוט מלא</TableHead>
                    <TableHead className="text-right w-20">העתק</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.source_name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {CATEGORIES.find((c) => c.value === s.source_type)?.label ?? s.source_type}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <span className="cursor-pointer"><RenderCitation text={s.full_citation} /></span>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-96 text-sm whitespace-pre-wrap break-words" dir="rtl" side="top">
                            <RenderCitation text={s.full_citation} />
                          </HoverCardContent>
                        </HoverCard>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleCopy(s.full_citation)} title="העתק ציטוט">
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table></div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
