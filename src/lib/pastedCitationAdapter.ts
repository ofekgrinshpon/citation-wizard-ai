import { buildPastedCitation, pastedCitationWarning, type CitationManualChoice, type PastedCitationContract } from "../../supabase/functions/_shared/pastedCitation";
import { detectForeignSource, renderForeignDetection } from "@/data/bluebook";
import { escapeCitationLiteral } from "@/lib/citationSegments";
import type { SourceType } from "@/data/abbreviations";
export function citationManualChoice(type?: SourceType, jurisdictionId?: string, subjurisdiction?: string): CitationManualChoice | null {
  if (!type && !jurisdictionId) return null;
  const jurisdiction = jurisdictionId === "us" || jurisdictionId?.startsWith("us:") ? "US"
    : jurisdictionId === "t2:united-kingdom" || jurisdictionId?.startsWith("uk:") ? "UK"
    : jurisdictionId === "t2:germany" ? "DE" : jurisdictionId === "t2:israel" ? "IL"
    : jurisdictionId ? "UNKNOWN" : type === "foreign_case_us" || type === "foreign_statute_us" ? "US"
    : type === "foreign_statute_uk" ? "UK" : type?.startsWith("case_law_") ? "IL" : "UNKNOWN";
  return { jurisdiction, sourceType: type, foreign: type?.startsWith("foreign"), ...(subjurisdiction ? { subjurisdiction } : {}) };
}
export function preparePastedCitation(raw: string, manual: CitationManualChoice | null = null) {
  const detection = detectForeignSource(raw);
  const contract = buildPastedCitation(raw, manual, detection ? { kind: detection.kind, fields: detection.fields as Record<string, unknown> } : undefined);
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
export function readPastedCitationSafety(contract: PastedCitationContract, response: unknown) {
  const c = (response as { pastedCitation?: PastedCitationContract } | null)?.pastedCitation;
  if (!c) return null; // Existing supported article/statute/recovery protocols remain unchanged.
  if (c.version !== 1 || c.fingerprint !== contract.fingerprint || c.rawInput !== contract.rawInput || c.route === "preserve") {
    const warningMsg = c.version === 1 && c.route === "preserve" ? pastedCitationWarning(c) : "תוצאת האזכור אינה תואמת לקלט; הקלט נשמר ללא השלמה.";
    return { citation: escapeCitationLiteral(contract.rawInput), reply: `${escapeCitationLiteral(contract.rawInput)}\n⚠️ ${warningMsg}`, warningMsg };
  }
  return null;
}