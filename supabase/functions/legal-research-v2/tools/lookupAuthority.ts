/**
 * legal-research-v2 — `lookup_authority` tool.
 *
 * Resolve a *named* Israeli authority to concrete candidate URLs / local
 * records. Registry presence is a clue only: nothing here verifies anything,
 * and the returned candidates must still be fetched and verified.
 */

import type { LookupCandidate } from "../types.ts";
import { CANONICAL_AUTHORITIES } from "../data/canonicalAuthorities.ts";
import {
  buildSectionVariants,
  classifyJudgmentUrl,
  detectDockets,
  normalizeDocketText,
  type SupabaseClient,
} from "../shared/primitives.ts";

export interface LookupInput {
  kind: "case" | "statute";
  docket?: string;
  title_hint?: string;
  statute?: string;
  section?: string;
}

export interface LookupOutput {
  candidates: LookupCandidate[];
  registry_hint: string | null;
  note: string;
}

function officialSearchUrls(kind: "case" | "statute", term: string): string[] {
  const q = encodeURIComponent(term);
  if (kind === "case") {
    return [
      `https://www.gov.il/he/departments/legalInfo/?limit=10&freeText=${q}`,
      `https://supremedecisions.court.gov.il/Home/Search?query=${q}`,
    ];
  }
  return [
    `https://www.nevo.co.il/laws/#/search/${q}`,
    `https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawPrimary.aspx?t=lawlaws&st=lawlaws&lawitemid=${q}`,
  ];
}

async function localRecords(
  admin: SupabaseClient,
  kind: "case" | "statute",
  term: string,
): Promise<LookupCandidate[]> {
  if (!term) return [];
  try {
    const { data, error } = await admin
      .from("legal_documents")
      .select("id,title,source_url,source_type")
      .ilike("title", `%${term}%`)
      .limit(5);
    if (error || !Array.isArray(data)) return [];
    return (data as Array<Record<string, unknown>>).map((row) => ({
      label: String(row.title ?? term),
      kind,
      url: typeof row.source_url === "string" ? row.source_url : undefined,
      origin: "local_corpus",
      local_document_id: String(row.id ?? ""),
      note: `source_type=${String(row.source_type ?? "unknown")}`,
    }));
  } catch {
    return [];
  }
}

export async function runLookupAuthority(
  admin: SupabaseClient,
  input: LookupInput,
): Promise<LookupOutput> {
  const kind = input.kind === "statute" ? "statute" : "case";
  const docket = input.docket
    ? (detectDockets(input.docket)[0]?.number ?? normalizeDocketText(input.docket))
    : undefined;
  const statute = input.statute?.trim();
  const section = input.section?.trim();
  const hint = (input.title_hint ?? "").trim();

  const term = kind === "case"
    ? [docket, hint].filter(Boolean).join(" ").trim()
    : [statute, section ? `סעיף ${section}` : ""].filter(Boolean).join(" ").trim() || hint;

  // Registry clue (data only — never a verification signal).
  const needle = `${docket ?? ""} ${hint} ${statute ?? ""}`.trim();
  const registryRow = CANONICAL_AUTHORITIES.find((a) =>
    a.kind === kind &&
    ((docket && a.docket === docket) ||
      a.match_terms.some((t) => t.length > 2 && needle.includes(t)))
  ) ?? null;

  const candidates: LookupCandidate[] = [];
  candidates.push(...await localRecords(admin, kind, docket || statute || hint));

  for (const url of officialSearchUrls(kind, term || hint || docket || statute || "")) {
    const cls = classifyJudgmentUrl(url, "unknown");
    candidates.push({
      label: registryRow?.label ?? term ?? hint ?? "(לא ידוע)",
      kind,
      docket,
      statute,
      section,
      url,
      origin: "official_search_entry",
      note: cls.guessed_pattern ? `guessed_url_pattern:${cls.guessed_pattern_id}` : "official search entry point — not a document",
    });
  }

  return {
    candidates,
    registry_hint: registryRow ? `${registryRow.authority_id}: ${registryRow.label}` : null,
    note: [
      "רמז בלבד. אף מועמד כאן אינו מאומת.",
      "יש להביא את גוף המסמך באמצעות fetch לפני שימוש כלשהו.",
      kind === "statute" && section
        ? `וריאנטים לסעיף: ${buildSectionVariants(section).slice(0, 6).join(", ")}`
        : "",
    ].filter(Boolean).join(" "),
  };
}
