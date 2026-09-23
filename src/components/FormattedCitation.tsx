import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { CITATION_PART_RULES, RULE_EXPLANATIONS } from "@/data/ruleTooltips";

/** Map missing field descriptions to likely rule numbers */
const MISSING_FIELD_RULES: Record<string, { rule: string; tip: string }> = {
  "עמוד": { rule: "18.6", tip: "חסר מספר עמוד תחילת פסק הדין לפי כלל 18.8" },
  "כרך": { rule: "18.6", tip: "חסר מספר כרך לפי כלל 18.6" },
  "שנה": { rule: "18.7", tip: "חסרה שנת פרסום לפי כלל 18.7" },
  "שנת פרסום": { rule: "23.9", tip: "חסרה שנת פרסום לפי כלל 23.9" },
  "צד": { rule: "18.4", tip: "חסר שם צד לפי כלל 18.4" },
  "משיב": { rule: "18.4", tip: "חסר שם המשיב לפי כלל 18.4" },
  "מספר תיק": { rule: "18.2", tip: "חסר מספר תיק לפי כלל 18.2" },
  "ס\"ח": { rule: "2.1", tip: "חסר עמוד בספר החוקים לפי כלל 2.1" },
  "ק\"ת": { rule: "6", tip: "חסר עמוד בקובץ התקנות לפי כלל 6" },
  "מאגר": { rule: "19.1", tip: "חסר שם מאגר ותאריך לפי כלל 19.1" },
  "URL": { rule: "30", tip: "חסרת כתובת URL לפי כלל 30" },
  "תאריך": { rule: "19.1", tip: "חסר תאריך פרסום לפי כלל 19.1" },
};

function getMissingFieldTooltip(inner: string): string | null {
  const lower = inner.toLowerCase();
  for (const [keyword, info] of Object.entries(MISSING_FIELD_RULES)) {
    if (lower.includes(keyword)) return info.tip;
  }
  return "פרט חיוני חסר – נא להשלים כדי לקבל אזכור תקין";
}

interface FormattedCitationProps {
  text: string;
  highlightMissing?: boolean;
  enableTooltips?: boolean;
}

/** Render a single segment with optional tooltip */
function SegmentWithTooltip({
  content,
  ruleKey,
  label,
}: {
  content: React.ReactNode;
  ruleKey: string;
  label: string;
}) {
  const explanation = RULE_EXPLANATIONS[ruleKey];
  if (!explanation) return <>{content}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help border-b border-dotted border-muted-foreground/40 hover:border-primary transition-colors">
          {content}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-xs text-right"
        style={{ direction: "rtl" }}
      >
        <p className="font-semibold text-xs text-primary mb-0.5">{label}</p>
        <p className="text-xs">{explanation}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Parse inline markers (**bold**, ##italic##, ^^small caps^^, [חסר:...]) into React nodes */
function parseInlineMarkers(
  text: string,
  highlightMissing: boolean
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldIdx = remaining.indexOf("**");
    const italicIdx = remaining.indexOf("##");
    const smallCapsIdx = remaining.indexOf("^^");
    const missingIdx = highlightMissing ? remaining.indexOf("[חסר:") : -1;

    const indices = [boldIdx, italicIdx, smallCapsIdx, missingIdx].filter((i) => i !== -1);

    if (indices.length === 0) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    const nextIdx = Math.min(...indices);
    let nextType: "bold" | "italic" | "smallcaps" | "missing";
    if (nextIdx === boldIdx) nextType = "bold";
    else if (nextIdx === italicIdx) nextType = "italic";
    else if (nextIdx === smallCapsIdx) nextType = "smallcaps";
    else nextType = "missing";

    if (nextIdx > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, nextIdx)}</span>);
    }

    if (nextType === "missing") {
      const closeIdx = remaining.indexOf("]", nextIdx);
      if (closeIdx === -1) {
        parts.push(<span key={key++}>{remaining.slice(nextIdx)}</span>);
        break;
      }
      const inner = remaining.slice(nextIdx, closeIdx + 1);
      const tooltipText = getMissingFieldTooltip(inner);
      parts.push(
        <Tooltip key={key++}>
          <TooltipTrigger asChild>
            <span className="bg-destructive/20 text-destructive px-1 py-0.5 rounded text-xs font-medium cursor-help border-b border-dashed border-destructive/50">
              {inner}
            </span>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="max-w-xs text-right"
            style={{ direction: "rtl" }}
          >
            <p className="text-xs font-semibold text-destructive mb-0.5">⚠️ פרט חסר</p>
            <p className="text-xs">{tooltipText}</p>
          </TooltipContent>
        </Tooltip>
      );
      remaining = remaining.slice(closeIdx + 1);
      continue;
    }

    const marker = nextType === "bold" ? "**" : "##";
    const closeIdx = remaining.indexOf(marker, nextIdx + 2);
    if (closeIdx === -1) {
      parts.push(<span key={key++}>{remaining.slice(nextIdx)}</span>);
      break;
    }
    const inner = remaining.slice(nextIdx + 2, closeIdx);
    if (nextType === "bold") {
      parts.push(
        <strong key={key++} className="font-bold">
          {inner}
        </strong>
      );
    } else {
      parts.push(
        <em key={key++} className="italic">
          {inner}
        </em>
      );
    }
    remaining = remaining.slice(closeIdx + 2);
  }

  return parts;
}

/**
 * Try to find a citation part rule that matches starting near position 0 of the raw text.
 * Returns the matched rule and the match boundaries, or null.
 */
function findPartRules(rawLine: string) {
  const matches: { start: number; end: number; ruleKey: string; label: string }[] = [];

  for (const rule of CITATION_PART_RULES) {
    if (!rule.ruleKey) continue; // skip display-only rules
    let m: RegExpExecArray | null;
    const regex = new RegExp(rule.pattern.source, "g");
    while ((m = regex.exec(rawLine)) !== null) {
      // Avoid duplicate overlapping matches
      const overlaps = matches.some(
        (existing) => m!.index < existing.end && m!.index + m![0].length > existing.start
      );
      if (!overlaps) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          ruleKey: rule.ruleKey,
          label: rule.label,
        });
      }
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

export function FormattedCitation({
  text,
  highlightMissing,
  enableTooltips = false,
}: FormattedCitationProps) {
  if (!enableTooltips) {
    return <>{parseInlineMarkers(text, !!highlightMissing)}</>;
  }

  // With tooltips: find rule-matching segments and wrap them
  const matches = findPartRules(text);

  if (matches.length === 0) {
    return <>{parseInlineMarkers(text, !!highlightMissing)}</>;
  }

  const result: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of matches) {
    // Text before this match
    if (match.start > cursor) {
      const before = text.slice(cursor, match.start);
      result.push(
        <span key={key++}>
          {parseInlineMarkers(before, !!highlightMissing)}
        </span>
      );
    }

    // The matched segment
    const segment = text.slice(match.start, match.end);
    const rendered = parseInlineMarkers(segment, !!highlightMissing);
    result.push(
      <SegmentWithTooltip
        key={key++}
        content={rendered}
        ruleKey={match.ruleKey}
        label={match.label}
      />
    );

    cursor = match.end;
  }

  // Remaining text after last match
  if (cursor < text.length) {
    result.push(
      <span key={key++}>
        {parseInlineMarkers(text.slice(cursor), !!highlightMissing)}
      </span>
    );
  }

  return <>{result}</>;
}
