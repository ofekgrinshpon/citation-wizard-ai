import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Printer, ExternalLink, FileCheck, Database, Globe, Upload } from "lucide-react";
import { copyRichText } from "@/lib/clipboard";
import { toast } from "sonner";

const DAVID_FONT = "David, 'David Libre', serif";

export interface CaseMetadata {
  title?: string | null;
  citation?: string | null;
  court?: string | null;
  decision_date?: string | null;
  case_number?: string | null;
  parties?: string | null;
  year?: string | null;
  source_url?: string | null;
}

export interface CaseSummaryReportProps {
  answer: string;
  metadata?: CaseMetadata;
  verifiedSource?: "user" | "local" | "external" | string;
  onClear?: () => void;
}

interface Section {
  heading: string;
  body: string;
}

/** Parse the AI summary into structured sections by **bold heading** markers. */
function parseSections(text: string): { headerLine: string | null; sections: Section[] } {
  // Find all **heading** anchors (heading-only lines).
  const headingRe = /(^|\n)\s*\*\*([^\n*]+?)\*\*\s*(?=\n|$)/g;
  const matches: { heading: string; index: number; endOfHeading: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(text)) !== null) {
    matches.push({
      heading: m[2].trim(),
      index: m.index + (m[1] ? m[1].length : 0),
      endOfHeading: headingRe.lastIndex,
    });
  }

  if (matches.length === 0) {
    return { headerLine: null, sections: [{ heading: "סיכום", body: text.trim() }] };
  }

  // Anything before the first heading is dropped (model preamble, if any).
  const sections: Section[] = matches.map((mi, i) => {
    const start = mi.endOfHeading;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    return { heading: mi.heading, body: text.slice(start, end).trim() };
  });

  // First section is "כותרת" — extract its body as the header line, leave the rest as sections.
  let headerLine: string | null = null;
  if (sections[0] && /^כותרת/.test(sections[0].heading)) {
    headerLine = sections[0].body.replace(/\s+/g, " ").trim();
    sections.shift();
  }

  return { headerLine, sections };
}

function sourceBadge(verifiedSource?: string) {
  switch (verifiedSource) {
    case "user":
      return { label: "מקור: הועלה ע\"י המשתמש", icon: Upload, color: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" };
    case "local":
      return { label: "מקור: מאגר מקומי", icon: Database, color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" };
    case "external":
      return { label: "מקור: אוחזר חיצונית", icon: Globe, color: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30" };
    default:
      return { label: "מקור: לא ידוע", icon: FileCheck, color: "bg-muted text-muted-foreground border-border" };
  }
}

function buildHeaderFromMetadata(md?: CaseMetadata): string {
  if (!md) return "";
  const parts: string[] = [];
  if (md.case_number) parts.push(md.case_number);
  if (md.parties) parts.push(md.parties);
  else if (md.title) parts.push(md.title);
  if (md.year) parts.push(`(${md.year})`);
  return parts.join(" | ");
}

function RenderInlineBold({ text }: { text: string }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <>
      {parts.map((seg, i) => (i % 2 === 1 ? <strong key={i}>{seg}</strong> : <span key={i}>{seg}</span>))}
    </>
  );
}

function RenderBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          <RenderInlineBold text={line} />
        </span>
      ))}
    </>
  );
}

export function CaseSummaryReport({ answer, metadata, verifiedSource, onClear }: CaseSummaryReportProps) {
  const { headerLine, sections } = parseSections(answer);
  const finalHeader = headerLine || buildHeaderFromMetadata(metadata);
  const badge = sourceBadge(verifiedSource);
  const BadgeIcon = badge.icon;

  const handleCopy = () => {
    const headerHtml = finalHeader
      ? `<div style="font-family: ${DAVID_FONT}; font-size: 14pt; font-weight: bold; text-align: center; margin-bottom: 12pt;">${finalHeader}</div>`
      : "";
    const sectionsHtml = sections
      .map(
        (s) =>
          `<div style="font-family: ${DAVID_FONT}; font-size: 12pt; line-height: 1.6; margin-bottom: 12pt;">
            <div style="font-weight: bold; font-size: 12pt; margin-bottom: 4pt;">${s.heading}</div>
            <div style="text-align: justify;">${s.body.replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</div>
          </div>`,
      )
      .join("");
    const html = `<div dir="rtl" style="font-family: ${DAVID_FONT}; direction: rtl;">${headerHtml}${sectionsHtml}</div>`;
    const plain =
      (finalHeader ? finalHeader + "\n\n" : "") +
      sections.map((s) => `${s.heading}\n${s.body}`).join("\n\n");
    copyRichText(html, plain);
    toast.success("הדו\"ח הועתק ללוח");
  };

  const handlePrint = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html dir="rtl"><head><meta charset="utf-8"><title>סיכום פסיקה</title>
      <style>
        body { font-family: ${DAVID_FONT}; direction: rtl; padding: 2cm; line-height: 1.6; }
        h1 { font-size: 18pt; text-align: center; margin-bottom: 1cm; }
        h2 { font-size: 13pt; margin-top: 1cm; margin-bottom: 0.4cm; }
        .body { font-size: 12pt; text-align: justify; white-space: pre-wrap; }
      </style></head><body>
      ${finalHeader ? `<h1>${finalHeader}</h1>` : ""}
      ${sections.map((s) => `<h2>${s.heading}</h2><div class="body">${s.body}</div>`).join("")}
      </body></html>
    `);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  return (
    <Card className="mt-4 border-2 border-primary/20 bg-gradient-to-b from-card to-muted/20">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold text-foreground">דו"ח סיכום פסיקה</span>
          <Badge variant="outline" className={`gap-1 text-[10px] ${badge.color}`}>
            <BadgeIcon className="w-3 h-3" />
            {badge.label}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs">
            <Copy className="w-3.5 h-3.5" /> העתק
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5 text-xs">
            <Printer className="w-3.5 h-3.5" /> הדפס
          </Button>
          {onClear && (
            <Button variant="ghost" size="sm" onClick={onClear} className="text-xs text-muted-foreground">
              נקה
            </Button>
          )}
        </div>
      </div>

      <CardContent className="p-4 sm:p-6 space-y-5" style={{ fontFamily: DAVID_FONT }}>
        {finalHeader && (
          <div className="text-center pb-4 border-b-2 border-primary/30">
            <div
              className="font-bold text-foreground"
              style={{ fontSize: "16pt", lineHeight: 1.4 }}
            >
              {finalHeader}
            </div>
            {metadata?.source_url && (
              <a
                href={metadata.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
              >
                <ExternalLink className="w-3 h-3" /> מקור הטקסט המלא
              </a>
            )}
          </div>
        )}

        {sections.map((s, idx) => (
          <div key={idx} className="space-y-2">
            <h3
              className="font-bold text-primary border-r-2 border-primary pr-3"
              style={{ fontSize: "13pt" }}
            >
              {s.heading}
            </h3>
            <div
              className="text-foreground whitespace-pre-wrap pr-3"
              style={{ fontSize: "12pt", textAlign: "justify", lineHeight: 1.7 }}
            >
              <RenderBlock text={s.body} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
