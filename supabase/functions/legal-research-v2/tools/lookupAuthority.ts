/**
 * legal-research-v2 — `lookup_authority` tool.
 *
 * Resolve a *named* Israeli authority to concrete candidate URLs / local
 * records. Registry presence is a clue only: nothing here verifies anything,
 * and the returned candidates must still be fetched and verified.
 *
 * Two deterministic improvements over a plain hint list:
 *   • every usable candidate gets a durable `result_id`, so the agent can
 *     fetch it exactly like a search result instead of copying a raw URL;
 *   • every candidate carries the authority it was produced FOR
 *     (`authority_key` + `expected_identity`), so identity survives the hop
 *     from lookup to fetch. That is an acquisition target, never proof:
 *     binding still requires body corroboration at fetch time.
 */

import type { CandidateKind, LookupCandidate } from "../types.ts";
import { CANONICAL_AUTHORITIES } from "../data/canonicalAuthorities.ts";
import {
  buildSectionVariants,
  classifyJudgmentUrl,
  detectDockets,
  normalizeDocketText,
  type SupabaseClient,
} from "../shared/primitives.ts";
import { authorityKeyOf } from "./acquisitionLedger.ts";
import { nextResultId } from "./resultIds.ts";
import { docketVariants, type LocalMatchBasis } from "./localCorpusBody.ts";

export interface LookupInput {
  kind: "case" | "statute";
  docket?: string;
  title_hint?: string;
  statute?: string;
  section?: string;
}

export interface LookupOutput {
  candidates: LookupCandidate[];
  /** Stable key of the authority this lookup was performed for, if any. */
  authority_key: string | null;
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

/**
 * Local corpus resolution for an authority the agent already chose.
 *
 * Match order (strongest first): normalized exact `case_number`, then a
 * citation carrying the same normalized docket, then — last — a constrained
 * title match. A title hit is NOT a trusted exact hit: every local candidate
 * still has to corroborate the requested identity from its own body before it
 * may bind, exactly like an HTTP-acquired body.
 */
async function localRecords(
  admin: SupabaseClient,
  kind: "case" | "statute",
  opts: { docket?: string; term: string },
): Promise<LookupCandidate[]> {
  const rows: Array<{ row: Record<string, unknown>; basis: LocalMatchBasis }> = [];
  const seen = new Set<string>();
  const push = (data: unknown, basis: LocalMatchBasis) => {
    for (const row of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
      const id = String(row.id ?? "");
      if (id && !seen.has(id)) {
        seen.add(id);
        rows.push({ row, basis });
      }
    }
  };

  const select = "id,title,source_url,docx_url,pdf_url,source_type,case_number,citation";
  const { variants } = opts.docket ? docketVariants(opts.docket) : { variants: [] as string[] };
  if (variants.length) {
    try {
      const { data } = await admin
        .from("legal_documents")
        .select(select)
        .in("case_number", variants)
        .limit(5);
      push(data, "case_number_exact");
    } catch { /* structured lane unavailable — fall through */ }
    for (const v of variants) {
      if (rows.length) break;
      try {
        const { data } = await admin
          .from("legal_documents")
          .select(select)
          .ilike("citation", `%${v}%`)
          .limit(5);
        push(data, "citation_docket");
      } catch { /* ignore */ }
    }
  }
  if (!rows.length && opts.term) {
    try {
      const { data } = await admin
        .from("legal_documents")
        .select(select)
        .ilike("title", `%${opts.term}%`)
        .limit(5);
      push(data, "title_ilike");
    } catch { /* ignore */ }
  }

  return rows.map(({ row, basis }) => {
    const url = [row.source_url, row.docx_url, row.pdf_url]
      .find((u) => typeof u === "string" && /^https?:\/\//i.test(u)) as string | undefined;
    return {
      label: String(row.title ?? opts.term),
      kind,
      url,
      origin: "local_corpus",
      local_document_id: String(row.id ?? ""),
      local_match_basis: basis,
      candidate_kind: "local_document" as CandidateKind,
      note: `local_match=${basis} source_type=${String(row.source_type ?? "unknown")}${
        row.case_number ? ` case_number=${String(row.case_number)}` : ""
      }`,
    };
  });
}

export async function runLookupAuthority(
  admin: SupabaseClient,
  input: LookupInput,
): Promise<LookupOutput> {
  const kind = input.kind === "statute" ? "statute" : "case";
  // The expected identity must keep the FULL case identity — proceeding type,
  // docket number and an explicitly supplied court qualifier. Reducing a
  // request to bare digits erased the very distinction corroboration needs
  // (ע"פ 6339/18 is not ע"א 6339/18). The stable authority key stays
  // number-based for compatibility (see authorityKeyOf).
  const detected = input.docket ? detectDockets(input.docket)[0] : undefined;
  const docketNumber = detected?.number ??
    (input.docket ? normalizeDocketText(input.docket) : undefined);
  const courtQualifier = input.docket?.match(/\(([^)]{1,40})\)/)?.[0];
  const docket = input.docket
    ? [detected?.prefix_he, courtQualifier, docketNumber].filter(Boolean).join(" ").trim()
    : undefined;
  const statute = input.statute?.trim();
  const section = input.section?.trim();
  const hint = (input.title_hint ?? "").trim();

  const term = kind === "case"
    ? [docket, hint].filter(Boolean).join(" ").trim()
    : [statute, section ? `סעיף ${section}` : ""].filter(Boolean).join(" ").trim() || hint;

  const expected_identity = kind === "case" ? { docket } : { statute, section };
  const authority_key = authorityKeyOf(expected_identity);

  // Registry clue (data only — never a verification signal).
  const needle = `${docket ?? ""} ${hint} ${statute ?? ""}`.trim();
  const registryRow = CANONICAL_AUTHORITIES.find((a) =>
    a.kind === kind &&
    ((docketNumber && a.docket === docketNumber) ||
      a.match_terms.some((t) => t.length > 2 && needle.includes(t)))
  ) ?? null;

  const candidates: LookupCandidate[] = [];
  candidates.push(
    ...await localRecords(admin, kind, {
      docket: docketNumber,
      term: docketNumber || statute || hint,
    }),
  );

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
      candidate_kind: "discovery_entry",
      note: cls.guessed_pattern
        ? `guessed_url_pattern:${cls.guessed_pattern_id}`
        : "נקודת כניסה לחיפוש רשמי — אינה גוף מסמך",
    });
  }

  // Durable identity + fetchable ids. Discovery entry points are labelled as
  // such so a search page can never masquerade as an acquired authority.
  for (const c of candidates) {
    c.docket = c.docket ?? docket;
    c.statute = c.statute ?? statute;
    c.section = c.section ?? section;
    c.candidate_kind = c.candidate_kind ?? "document";
    if (authority_key) {
      c.authority_key = authority_key;
      c.expected_identity = { ...expected_identity };
    }
    // A stored local body is fetchable even when the row carries no URL.
    if (c.url || c.local_document_id) c.result_id = nextResultId();
  }

  const documentCandidates = candidates.filter(
    (c) => (c.url || c.local_document_id) && c.candidate_kind !== "discovery_entry",
  ).length;

  return {
    candidates,
    authority_key,
    registry_hint: registryRow ? `${registryRow.authority_id}: ${registryRow.label}` : null,
    note: [
      "רמז בלבד. אף מועמד כאן אינו מאומת.",
      "יש להביא את גוף המסמך באמצעות fetch לפני שימוש כלשהו — אפשר ישירות לפי result_id.",
      `מועמדי מסמך: ${documentCandidates}; נקודות כניסה לחיפוש: ${candidates.length - documentCandidates}.`,
      "candidate_kind=\"discovery_entry\" הוא דף חיפוש ולא גוף מסמך.",
      kind === "statute" && section
        ? `וריאנטים לסעיף: ${buildSectionVariants(section).slice(0, 6).join(", ")}`
        : "",
    ].filter(Boolean).join(" "),
  };
}
