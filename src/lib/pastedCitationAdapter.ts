import { buildPastedCitation, pastedCitationWarning, type CitationManualChoice, type PastedCitationContract } from "../../supabase/functions/_shared/pastedCitation";
import { detectForeignSource, renderForeignDetection } from "@/data/bluebook";
import { escapeCitationLiteral } from "@/lib/citationSegments";
import type { SourceType } from "@/data/abbreviations";
export function citationManualChoice(type?: SourceType, jurisdictionId?: string, subjurisdiction?: string): CitationManualChoice | null {
  if (!type && !jurisdictionId) return null;
  const jurisdiction = jurisdictionId === "us" || jurisdictionId?.startsWith("us:") ? "US"
    : jurisdictionId === "t2:united-kingdom" || jurisdictionId?.startsWith("t2:united-kingdom/") ? "UK"
    : jurisdictionId === "t2:germany-federal-republic-of" || jurisdictionId?.startsWith("t2:germany-federal-republic-of/") ? "DE" : jurisdictionId === "t2:israel" ? "IL"
    : jurisdictionId ? "UNKNOWN" : type === "foreign_case_us" || type === "foreign_statute_us" ? "US"
    : type === "foreign_statute_uk" ? "UK" : type?.startsWith("case_law_") ? "IL" : "UNKNOWN";
  return { jurisdiction, sourceType: type, foreign: type?.startsWith("foreign"), ...(subjurisdiction ? { subjurisdiction } : {}) };
}
export function preparePastedCitation(raw: string, manual: CitationManualChoice | null = null) {
  const detection = detectForeignSource(raw);
  const contract = buildPastedCitation(raw, manual, detection ? { kind: detection.kind, fields: detection.fields as Record<string, unknown> } : undefined);
  if (manual?.subjurisdiction && !["t2:united-kingdom/england-and-wales"].includes(manual.subjurisdiction) && contract.jurisdiction === "UK") {
    contract.route = "preserve"; contract.formatter = "unsupported"; contract.unsupported.push("subjurisdiction_formatter_not_supported");
  }
  const preserved = () => ({ citation: escapeCitationLiteral(raw), reply: `${escapeCitationLiteral(raw)}\n⚠️ ${pastedCitationWarning(contract)}`, warningMsg: pastedCitationWarning(contract) });
  if (contract.route === "preserve") return { contract, local: preserved(), detection };
  // Only complete supported case forms. Existing literature ambiguity gates stay authoritative.
  const rendered = detection?.kind === "case" && detection.confidence === "deterministic" &&
    (!manual?.sourceType || manual.sourceType === detection.sourceType) ? renderForeignDetection(detection) : null;
  const local = rendered && !rendered.missing.length ? {
    citation: rendered.citation,
    reply: `${rendered.citation}\n⚠️ ${[...rendered.warnings, "עוצב לפי הפרטים שסופקו; זהות המקור לא אומתה."].join(" ")}`,
    warningMsg: rendered.warnings[0] ?? "זהות המקור לא אומתה.",
  } : null;
  return { contract, local, detection };
}
export function pastedCaseRequest(raw: string, contract: PastedCitationContract) {
  if (contract.route !== "foreign" || contract.sourceKind !== "case") return null;
  const detection = detectForeignSource(raw);
  const parsedFields: Record<string, string> = {};
  if (detection?.kind === "case") for (const [k,v] of Object.entries(detection.fields)) if (typeof v === "string" && v) parsedFields[k] = v;
  if (!parsedFields.caseName) {
    const name = raw.match(/^\s*(.+?\s+v(?:s)?\.?\s+.+?)(?:\s*[,([]\s*(?:\d|\[)|\s*\(|\s*\[|$)/);
    if (name) parsedFields.caseName = name[1].trim().replace(/[,\s]+$/, "");
  }
  return { enabled: true, kind: "case" as const, jurisdiction: contract.jurisdiction === "US" || contract.jurisdiction === "UK" ? contract.jurisdiction : "UNKNOWN", rawInput: raw, parsedFields };
}
export function renderPastedCaseResponse(contract: PastedCitationContract, request: ReturnType<typeof pastedCaseRequest>, response: unknown) {
  if (!request) return null;
  const fl = response as { identity?: { matched?: boolean; jurisdiction?: "US" | "UK"; conflicts?: string[] }; fields?: Record<string, unknown> } | null;
  if (fl?.identity?.matched && fl.fields && !Object.keys(fl.fields).some(k => ["caseName", "court", "reporter", "year", "firstPage", "neutral", "docket"].includes(k))) return null;
  const jurisdiction = fl?.identity?.jurisdiction ?? (request.jurisdiction === "US" || request.jurisdiction === "UK" ? request.jurisdiction : undefined);
  if (fl?.identity?.conflicts?.length || (fl?.identity?.jurisdiction && request.jurisdiction !== "UNKNOWN" && fl.identity.jurisdiction !== request.jurisdiction)) {
    const warningMsg = "פרטי השיפוט שהוחזרו סותרים את הבחירה או הקלט; המקור שסופק נשמר ללא השלמה.";
    return { citation: escapeCitationLiteral(contract.rawInput), reply: `${escapeCitationLiteral(contract.rawInput)}\n⚠️ ${warningMsg}`, warningMsg };
  }
  if (fl?.identity?.matched && !fl.identity.conflicts?.length && (jurisdiction === "US" || jurisdiction === "UK") &&
    (request.jurisdiction === "UNKNOWN" || jurisdiction === request.jurisdiction) && fl.fields) {
    const suppliedKeys = ["caseName", "court", "reporter", "docket", "year", "decisionDate", "volume", "firstPage", "pinpoint", "paragraph", "neutral", "parallel", "unparsedRemainder"];
    const safeFields = Object.fromEntries(Object.entries(fl.fields).filter(([k,v]) => suppliedKeys.includes(k) && typeof v === "string"));
    const rendered = renderForeignDetection({ kind: "case", jurisdiction, sourceType: jurisdiction === "US" ? "foreign_case_us" : "foreign_case_other",
      confidence: "deterministic", fields: { ...safeFields, ...request.parsedFields } });
    if (rendered) {
      const warnings = [...rendered.warnings, ...(rendered.missing.length ? ["חסרים פרטים: " + rendered.missing.join(", ")] : [])];
      return { citation: rendered.citation, reply: rendered.citation + (warnings.length ? `\n⚠️ ${warnings.join(" ")}` : ""), warningMsg: warnings[0] };
    }
  }
  const warningMsg = "לא אומתה התאמת המקור לפרטים שסופקו; הקלט נשמר ללא השלמה.";
  return { citation: escapeCitationLiteral(contract.rawInput), reply: `${escapeCitationLiteral(contract.rawInput)}\n⚠️ ${warningMsg}`, warningMsg };
}
export function readPastedCitationSafety(contract: PastedCitationContract, response: unknown) {
  const c = (response as { pastedCitation?: PastedCitationContract } | null)?.pastedCitation;
  if (!c) return null; // Existing supported article/statute/recovery protocols remain unchanged.
  if (c.version !== 1 || c.fingerprint !== contract.fingerprint || c.rawInput !== contract.rawInput || c.route === "preserve") {
    const warningMsg = c.version === 1 && c.route === "preserve" && Array.isArray(c.conflicts) && Array.isArray(c.unsupported)
      ? pastedCitationWarning(c) : "תוצאת האזכור אינה תואמת לקלט; הקלט נשמר ללא השלמה.";
    return { citation: escapeCitationLiteral(contract.rawInput), reply: `${escapeCitationLiteral(contract.rawInput)}\n⚠️ ${warningMsg}`, warningMsg };
  }
  return null;
}