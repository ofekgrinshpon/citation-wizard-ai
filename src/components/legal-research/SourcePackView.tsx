import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, ExternalLink, ChevronDown } from "lucide-react";
import { copyPlainText } from "@/lib/clipboard";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/** Deterministic Source Renderer payload produced by legal-research-v2. */
export interface PackSource {
  source_id: string;
  title: string;
  url?: string | null;
  group: string;
  source_type_he: string;
  jurisdiction_he?: string | null;
  identifier?: string | null;
  origin_he?: string;
  reason_he?: string;
  excerpt?: string | null;
  span_verified?: boolean;
  state_he?: string;
}

export interface PackLead {
  title: string;
  url?: string | null;
  source_type_he: string;
  origin_he?: string;
  note_he?: string;
}

export interface SourcePack {
  mode: "sources";
  question?: string;
  run_id?: string;
  recommended: PackSource[];
  groups: Array<{ key: string; label_he: string; sources: PackSource[] }>;
  leads: PackLead[];
  summary?: {
    discovered?: number;
    fetched?: number;
    readable?: number;
    recommended?: number;
    leads?: number;
  };
  unresolved_questions?: string[];
}

function packToText(pack: SourcePack): string {
  const lines: string[] = ["מקורות מומלצים", ""];
  pack.groups.forEach((g) => {
    lines.push(g.label_he);
    g.sources.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.title}${s.identifier ? ` (${s.identifier})` : ""}`);
      if (s.url) lines.push(`   ${s.url}`);
      if (s.reason_he) lines.push(`   ${s.reason_he}`);
    });
    lines.push("");
  });
  if (pack.leads.length > 0) {
    lines.push("כיווני חיפוש נוספים (לא נקראו ולא אומתו)");
    pack.leads.forEach((l) => {
      lines.push(`- ${l.title}${l.url ? ` — ${l.url}` : ""}`);
    });
  }
  return lines.join("\n");
}

function SourceCard({ source }: { source: PackSource }) {
  return (
    <li className="rounded-lg border border-border bg-card p-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px]">{source.source_type_he}</Badge>
        {source.jurisdiction_he && (
          <Badge variant="outline" className="text-[10px]">{source.jurisdiction_he}</Badge>
        )}
        {source.state_he && (
          <Badge
            variant="outline"
            className={`text-[10px] ${
              source.span_verified
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                : "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30"
            }`}
          >
            {source.state_he}
          </Badge>
        )}
        {source.origin_he && (
          <span className="text-[10px] text-muted-foreground">{source.origin_he}</span>
        )}
      </div>

      <div className="text-sm font-medium text-foreground leading-relaxed">
        {source.title}
        {source.identifier && (
          <span className="text-muted-foreground font-normal"> · {source.identifier}</span>
        )}
      </div>

      {source.reason_he && (
        <p className="text-xs text-muted-foreground leading-relaxed">{source.reason_he}</p>
      )}

      {source.excerpt && (
        <blockquote className="border-r-2 border-primary/40 pr-2 text-xs text-foreground/90 leading-relaxed">
          "{source.excerpt}"
        </blockquote>
      )}

      {source.url && (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="w-3 h-3" /> פתיחת המקור
        </a>
      )}
    </li>
  );
}

export function SourcePackView({ pack }: { pack: SourcePack }) {
  const [leadsOpen, setLeadsOpen] = useState(false);
  const s = pack.summary ?? {};

  const handleCopy = async () => {
    await copyPlainText(packToText(pack));
    toast.success("רשימת המקורות הועתקה ללוח");
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          נסרקו {s.discovered ?? 0} מקורות · נקראו {s.readable ?? 0} · מומלצים {pack.recommended.length}
        </p>
        <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs">
          <Copy className="w-3.5 h-3.5" /> העתק רשימה
        </Button>
      </div>

      {pack.recommended.length === 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-foreground">
          לא נמצאו מקורות שניתן היה לקרוא ולאמת בשאילתה הזו. הכיוונים שאותרו מוצגים למטה כלא מאומתים.
        </div>
      )}

      {pack.groups.map((g) => (
        <div key={g.key} className="space-y-2">
          <h3 className="text-sm font-bold text-foreground">{g.label_he}</h3>
          <ul className="space-y-2">
            {g.sources.map((src) => (
              <SourceCard key={src.source_id} source={src} />
            ))}
          </ul>
        </div>
      ))}

      {pack.leads.length > 0 && (
        <Collapsible open={leadsOpen} onOpenChange={setLeadsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${leadsOpen ? "rotate-180" : ""}`} />
              כיווני חיפוש נוספים ({pack.leads.length}) — לא נקראו ולא אומתו
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <ul className="space-y-1.5">
              {pack.leads.map((l, i) => (
                <li key={`${l.url ?? l.title}-${i}`} className="text-xs text-muted-foreground leading-relaxed">
                  <span className="text-foreground">{l.title}</span>
                  {l.note_he && <span> · {l.note_he}</span>}
                  {l.url && (
                    <>
                      {" "}
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        קישור
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      {pack.unresolved_questions && pack.unresolved_questions.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <h4 className="text-xs font-bold text-foreground mb-1">מה נותר פתוח</h4>
          <ul className="list-disc pr-4 space-y-1 text-xs text-muted-foreground">
            {pack.unresolved_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
