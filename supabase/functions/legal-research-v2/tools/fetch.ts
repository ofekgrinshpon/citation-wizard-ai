/**
 * legal-research-v2 — `fetch` tool.
 *
 * Retrieve actual readable legal text and append it to the evidence store.
 * Reuses the proven low-level HTTP/extraction primitives (official fetch
 * profiles + court egress relay, bounded PDF page extraction, DOCX, HTML) and
 * nothing above them: no acquisition stage, no fallback hierarchy, no rescue.
 * If a fetch fails, the research agent decides what to do next.
 *
 * Context discipline: the full body is stored server-side; the tool response
 * carries only a summary plus bounded excerpts. An already-read source is
 * answered from the store, and `fetch({source_id, query})` re-reads a specific
 * part of it without re-injecting the document.
 */

import type { EvidenceSource, SearchResult } from "../types.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import { excerptWindows } from "../evidence/evidenceStore.ts";
import {
  extractDocumentText,
  extractPdfPagesBounded,
  htmlToText,
  looksLikeBlockPage,
  officialFetch,
} from "../shared/primitives.ts";
import { AcquisitionLedger, type AuthorityState, authorityKeyOf } from "./acquisitionLedger.ts";
import { corroborateAuthority } from "./authorityCorroboration.ts";
import { locateSection, normalizeSectionToken, sectionMissingInstruction } from "../evidence/sectionLocator.ts";
import { normalizeUrlKey } from "../evidence/evidenceStore.ts";
import type { ServedQuote } from "../evidence/quotable.ts";

export const FETCH_LIMITS = {
  TIMEOUT_MS: 25_000,
  MAX_BYTES: 24 * 1024 * 1024,
  MAX_TEXT_CHARS: 200_000,
  PDF_MAX_PAGES: 24,
  PDF_DEADLINE_MS: 12_000,
  PDF_ENOUGH_CHARS: 80_000,
  MIN_DOCUMENT_CHARS: 400,
  /** Context ceilings — the agent never receives a whole body. */
  HEAD_CHARS: 1_400,
  WINDOW_CHARS: 1_200,
  MAX_WINDOWS: 3,
  MAX_RESPONSE_CHARS: 6_500,
};

/** Deterministic "this is not a document" signatures. One small set, no taxonomy. */
const LISTING_SIGNATURES = [
  "תוצאות חיפוש",
  "לא נמצאו תוצאות",
  "search results",
  "no results found",
  "מנוע חיפוש",
  "רשימת פסקי דין",
  "התחבר כדי לצפות",
  "נדרשת הרשמה",
  "subscribe to continue",
  "enable javascript",
  "דפדפן אינו נתמך",
];

export interface DocumentCheck {
  is_actual_document: boolean;
  reason?: string;
}

export function checkIsActualDocument(text: string): DocumentCheck {
  const t = (text ?? "").trim();
  if (t.length < FETCH_LIMITS.MIN_DOCUMENT_CHARS) {
    return { is_actual_document: false, reason: "too_short_for_a_document" };
  }
  if (looksLikeBlockPage(t)) {
    return { is_actual_document: false, reason: "block_page" };
  }
  const head = t.slice(0, 3_000).toLowerCase();
  const hit = LISTING_SIGNATURES.find((s) => head.includes(s.toLowerCase()));
  if (hit && t.length < 8_000) {
    return { is_actual_document: false, reason: `listing_or_portal_shell:${hit}` };
  }
  // A portal shell is mostly navigation: very little running prose.
  const sentences = (t.match(/[.!?׃:]\s/g) ?? []).length;
  if (t.length < 2_000 && sentences < 3) {
    return { is_actual_document: false, reason: "portal_shell_no_prose" };
  }
  return { is_actual_document: true };
}

async function extractByContentType(
  url: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<{ text: string; error?: string }> {
  const ct = contentType.toLowerCase();
  const isPdf = ct.includes("pdf") || /\.pdf(\?|$)/i.test(url) ||
    (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50);
  if (isPdf) {
    try {
      const res = await extractPdfPagesBounded(bytes, {
        maxPages: FETCH_LIMITS.PDF_MAX_PAGES,
        maxChars: FETCH_LIMITS.MAX_TEXT_CHARS,
        deadlineMs: FETCH_LIMITS.PDF_DEADLINE_MS,
        enoughChars: FETCH_LIMITS.PDF_ENOUGH_CHARS,
      });
      return { text: res.text };
    } catch (e) {
      return { text: "", error: `pdf_extract_failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (ct.includes("wordprocessingml") || /\.docx(\?|$)/i.test(url)) {
    try {
      return { text: await extractDocumentText(bytes, "docx") };
    } catch (e) {
      return { text: "", error: `docx_extract_failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (ct.includes("html") || /<html[\s>]/i.test(raw.slice(0, 2_000))) {
    return { text: htmlToText(raw) };
  }
  return { text: raw.trim() };
}

/** Return reading windows around the agent's search terms (verbatim slices). */
export function readingWindows(text: string, find: string[]): string[] {
  return excerptWindows(text, find, {
    window: FETCH_LIMITS.WINDOW_CHARS,
    max: FETCH_LIMITS.MAX_WINDOWS,
  });
}

/** Register windows as literal quotable text and shape them for the response. */
export function serveExactText(
  store: EvidenceStore,
  source_id: string,
  windows: string[] | undefined,
  issue?: string,
): { windows?: string[]; exact_source_text?: Array<{ quote_id: string; text: string }> } {
  if (!windows?.length) return {};
  const served: ServedQuote[] = store.serveQuotes(source_id, windows, issue);
  if (!served.length) return { windows };
  return {
    windows: served.map((q) => q.text),
    exact_source_text: served.map((q) => ({ quote_id: q.quote_id, text: q.text })),
  };
}

const QUOTE_RULE =
  " צטט מילה במילה מתוך exact_source_text בלבד — כל quoted_span חייב להיות העתקה מדויקת של רצף תווים מתוך הקטעים שהוחזרו, ללא ניסוח מחדש, קיצור פנימי או תרגום.";

export interface FetchInput {
  result_id?: string;
  url?: string;
  /** Targeted re-read of a document already in the evidence store. */
  source_id?: string;
  query?: string;
  locator?: string;
  want?: string;
  expected_identity?: { docket?: string; statute?: string; section?: string };
  /** Optional in-document search terms; returns verbatim windows around them. */
  find?: string[];
  /** Explicit justification for re-fetching an already-read URL. */
  refetch_reason?: string;
}

export interface FetchOutput {
  ok: boolean;
  source_id?: string;
  title?: string;
  summary?: string;
  text_length?: number;
  is_actual_document?: boolean;
  not_document_reason?: string;
  identity_found?: { dockets: string[]; statutes: string[]; sections: string[] };
  identity_hint?: string;
  text_head?: string;
  windows?: string[];
  /**
   * The literal, quotable form of the returned windows. `quoted_span` in the
   * research memo must be copied from here, character for character.
   */
  exact_source_text?: Array<{ quote_id: string; text: string }>;
  /** True when the body was already in the evidence store (no new HTTP call). */
  deduped?: boolean;
  already_read?: boolean;
  instruction?: string;
  acquisition_note?: string;
  /** Compact per-authority acquisition state (attempted hosts, usable body). */
  authority_state?: AuthorityState;
  /** True when a usable body for this authority already exists elsewhere. */
  authority_reuse?: boolean;
  /** Internal telemetry: the body corroborated the requested authority. */
  authority_identity_corroborated?: boolean;
  /** Internal telemetry: a binding authority_key → source was created. */
  authority_binding_created?: boolean;
  /** Internal telemetry: readable body, but identity unconfirmed → no binding. */
  authority_binding_withheld?: boolean;
  /** Deterministic reason string for the binding decision. */
  authority_binding_basis?: string;
  /** True when this exact URL already failed for this authority. */
  dead_path?: boolean;
  /** Targeted section retrieval outcome. */
  section_requested?: string;
  section_found?: boolean;
  section_coverage?: { first: string | null; last: string | null; count: number };
  /**
   * Advisory only: equivalent queries on this source have not been yielding.
   * The agent keeps full discretion over what to do next.
   */
  search_path_exhausted?: boolean;
  same_issue_no_yield?: number;
  no_new_evidence?: boolean;
  error?: string;
}

function alreadyReadPayload(
  store: EvidenceStore,
  cached: EvidenceSource,
  input: FetchInput,
): FetchOutput {
  const terms = [
    ...(input.find ?? []),
    ...(input.query ? [input.query] : []),
    ...(input.locator ? [input.locator] : []),
  ];
  const raw = terms.length ? readingWindows(cached.extracted_text, terms) : undefined;
  const served = serveExactText(store, cached.source_id, raw, input.query ?? input.locator);
  const windows = served.windows;
  return {
    ok: cached.fetch_status === "ok",
    already_read: true,
    deduped: true,
    source_id: cached.source_id,
    title: cached.title,
    summary: cached.summary,
    text_length: cached.text_length,
    is_actual_document: cached.is_actual_document,
    not_document_reason: cached.not_document_reason,
    identity_found: cached.identity_fields,
    windows: windows?.length ? windows : undefined,
    exact_source_text: served.exact_source_text,
    text_head: windows?.length ? undefined : cached.extracted_text.slice(0, FETCH_LIMITS.HEAD_CHARS),
    instruction: cached.fetch_status === "ok" && cached.is_actual_document
      ? `מקור זה כבר נקרא בריצה זו. אל תביא אותו שוב אלא אם נדרשת הבאה שונה מהותית. לקריאה ממוקדת בתוכו: fetch({source_id, query}).${
        windows?.length ? QUOTE_RULE : ""
      }`
      : `נתיב זה כבר נוסה בריצה זו ולא הניב מסמך קריא (${cached.not_document_reason ?? cached.fetch_error ?? "unusable"}). אל תחזור עליו — פנה למקור רשמי אחר או לנוסח משולב אמין.`,
    error: cached.fetch_status === "ok" ? undefined : cached.fetch_error,
  };
}

/** Clamp every string field so a single tool response can never blow up context. */
export function clampFetchOutput(out: FetchOutput): FetchOutput {
  const clamped: FetchOutput = { ...out };
  if (clamped.text_head) clamped.text_head = clamped.text_head.slice(0, FETCH_LIMITS.HEAD_CHARS);
  if (clamped.summary) clamped.summary = clamped.summary.slice(0, 900);
  if (clamped.windows) {
    clamped.windows = clamped.windows
      .slice(0, FETCH_LIMITS.MAX_WINDOWS)
      .map((w) => w.slice(0, FETCH_LIMITS.WINDOW_CHARS));
  }
  if (clamped.exact_source_text) {
    clamped.exact_source_text = clamped.exact_source_text
      .slice(0, FETCH_LIMITS.MAX_WINDOWS)
      .map((q) => ({ quote_id: q.quote_id, text: q.text.slice(0, FETCH_LIMITS.WINDOW_CHARS) }));
  }
  // Last-resort ceiling on the serialized payload.
  let json = JSON.stringify(clamped);
  while (json.length > FETCH_LIMITS.MAX_RESPONSE_CHARS && clamped.windows?.length) {
    clamped.windows = clamped.windows.slice(0, clamped.windows.length - 1);
    if (clamped.exact_source_text?.length) {
      clamped.exact_source_text = clamped.exact_source_text.slice(0, clamped.windows.length);
    }
    json = JSON.stringify(clamped);
  }
  if (json.length > FETCH_LIMITS.MAX_RESPONSE_CHARS && clamped.text_head) {
    clamped.text_head = clamped.text_head.slice(0, 800);
  }
  return clamped;
}

export async function runFetch(
  store: EvidenceStore,
  discovered: Map<string, SearchResult>,
  input: FetchInput,
  ledger?: AcquisitionLedger,
): Promise<FetchOutput> {
  // ── Targeted re-read of an already-stored body (no HTTP, no budget) ──────
  if (input.source_id && !input.url && !input.result_id) {
    const src = store.get(input.source_id);
    if (!src) return { ok: false, error: `unknown_source_id:${input.source_id}` };

    // ── Targeted section retrieval ────────────────────────────────────────
    // A long consolidated statute is not limited to its first text window:
    // the requested provision is located inside the stored body, and if the
    // body cannot serve it that is said plainly so the agent pivots.
    const sectionRequest = input.expected_identity?.section ?? input.locator ??
      (input.want === "relevant_section" ? input.query : undefined);
    const sectionToken = sectionRequest ? normalizeSectionToken(sectionRequest) : null;
    if (sectionToken) {
      if (ledger?.knownMissingLocator(src.source_id, sectionToken)) {
        const known = locateSection(src.extracted_text, sectionToken, {
          truncated: src.text_length >= FETCH_LIMITS.MAX_TEXT_CHARS,
        });
        const prior = store.servedQuotes(src.source_id).slice(-2);
        return clampFetchOutput({
          ok: false,
          already_read: true,
          no_new_evidence: true,
          search_path_exhausted: true,
          same_issue_no_yield: ledger?.readState(src.source_id)?.no_yield,
          source_id: src.source_id,
          section_requested: sectionToken,
          section_found: false,
          section_coverage: known.coverage,
          exact_source_text: prior.length
            ? prior.map((q) => ({ quote_id: q.quote_id, text: q.text }))
            : undefined,
          instruction: sectionMissingInstruction(known, src.source_id),
        });
      }
      const found = locateSection(src.extracted_text, sectionToken, {
        window: FETCH_LIMITS.WINDOW_CHARS + 600,
        truncated: src.text_length >= FETCH_LIMITS.MAX_TEXT_CHARS,
      });
      const read = ledger?.noteRead(src.source_id, {
        yielded: found.found,
        locator: found.found ? null : sectionToken,
      });
      // Not the requested section, but do not withhold what the body does say:
      // return bounded term windows as clearly-labelled context.
      const fallback = found.found ? null : store.excerpt(src.source_id, {
        query: input.query,
        find: input.find,
        maxChars: FETCH_LIMITS.WINDOW_CHARS,
      });
      const fallbackWindows = fallback && fallback.from !== "head" ? fallback.windows : undefined;
      const servedSection = serveExactText(
        store,
        src.source_id,
        found.found ? found.windows : fallbackWindows,
        found.found ? `סעיף ${sectionToken}` : input.query,
      );
      return clampFetchOutput({
        ok: found.found && src.fetch_status === "ok",
        already_read: true,
        source_id: src.source_id,
        title: src.title,
        text_length: src.text_length,
        is_actual_document: src.is_actual_document,
        identity_found: src.identity_fields,
        section_requested: sectionToken,
        section_found: found.found,
        section_coverage: found.coverage,
        windows: servedSection.windows,
        exact_source_text: servedSection.exact_source_text,
        no_new_evidence: found.found || fallbackWindows ? undefined : true,
        search_path_exhausted: found.found ? undefined : read?.exhausted || undefined,
        same_issue_no_yield: found.found ? undefined : read?.no_yield,
        instruction: found.found
          ? `סעיף ${sectionToken} אותר בתוך ${src.source_id}.${QUOTE_RULE}`
          : `${sectionMissingInstruction(found, src.source_id)}${
            fallbackWindows ? " (הוחזרו חלונות טקסט לפי מונחי החיפוש בלבד — אינם הסעיף המבוקש.)" : ""
          }`,
      });
    }

    const ex = store.excerpt(input.source_id, {
      query: input.query,
      locator: input.locator,
      find: input.find,
      maxChars: FETCH_LIMITS.WINDOW_CHARS,
    })!;
    // "head" means no query term matched: this read produced no new evidence.
    const yielded = ex.from !== "head";
    const read = ledger?.noteRead(src.source_id, {
      yielded,
      locator: yielded ? null : (input.query ?? input.locator ?? null),
    });
    const servedRead = serveExactText(store, src.source_id, ex.windows, input.query ?? input.locator);
    const advisory = !yielded && read?.exhausted
      ? ` שים לב: ${read.no_yield} קריאות ממוקדות רצופות על מקור זה לא הניבו ראיה חדשה. ההמלצה היא לפנות למקור אחר או לנתיב השגה אחר, אך ההחלטה שלך.`
      : "";
    return clampFetchOutput({
      ok: src.fetch_status === "ok",
      already_read: true,
      source_id: src.source_id,
      title: src.title,
      summary: src.summary,
      text_length: src.text_length,
      is_actual_document: src.is_actual_document,
      identity_found: src.identity_fields,
      windows: servedRead.windows,
      exact_source_text: servedRead.exact_source_text,
      no_new_evidence: yielded ? undefined : true,
      search_path_exhausted: !yielded && read?.exhausted ? true : undefined,
      same_issue_no_yield: yielded ? undefined : read?.no_yield,
      instruction: yielded
        ? `קריאה ממוקדת בתוך ${src.source_id} (${ex.from}).${QUOTE_RULE}`
        : `לא נמצאה התאמה לשאילתה בתוך ${src.source_id}; הוחזרה פתיחת המסמך בלבד (טקסט מילולי).${advisory}${QUOTE_RULE}`,
    });
  }

  const discovery = input.result_id ? discovered.get(input.result_id) ?? null : null;
  const url = input.url || discovery?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "no_usable_url" };
  }

  const authorityKey = authorityKeyOf(input.expected_identity ?? {});

  // Per-run fetch dedupe: an already-read URL is served from the evidence
  // store and does not consume fetch budget, unless a refetch reason is given.
  if (!input.refetch_reason?.trim()) {
    const cached = store.findByUrl(url);
    if (cached) return clampFetchOutput(alreadyReadPayload(store, cached, input));
  }

  // ── Same-authority acquisition efficiency ────────────────────────────────
  // Identity verification is unchanged: this only avoids repeating network
  // work for an authority whose body was ALREADY acquired with a matching
  // identity, and avoids re-walking a path that already failed.
  if (ledger && authorityKey && !input.refetch_reason?.trim()) {
    const acquiredId = ledger.get(authorityKey)?.acquired_source_id;
    const acquired = acquiredId ? store.get(acquiredId) : null;
    if (acquired && normalizeUrlKey(acquired.url ?? "") !== normalizeUrlKey(url)) {
      return clampFetchOutput({
        ...alreadyReadPayload(store, acquired, input),
        authority_reuse: true,
        authority_state: ledger.state(authorityKey) ?? undefined,
        instruction:
          `גוף האסמכתה ${authorityKey} כבר הובא ואומת זהותית (${acquired.source_id}). עבוד מתוכו: fetch({source_id:"${acquired.source_id}", query}). אל תחפש עותקים נוספים אלא אם חסר בו רכיב ספציפי — ואז ציין refetch_reason.`,
      });
    }
    const prior = ledger.attemptOn(authorityKey, url);
    if (prior && prior.outcome !== "acquired" && prior.outcome !== "readable_unconfirmed_identity") {
      return clampFetchOutput({
        ok: false,
        dead_path: true,
        error: `dead_acquisition_path:${prior.reason}`.slice(0, 160),
        authority_state: ledger.state(authorityKey) ?? undefined,
        instruction:
          "כתובת זו כבר נוסתה בריצה זו ונכשלה. אל תחזור עליה. נסה מקור שונה מהותית או המשך עם מה שכבר נקרא.",
      });
    }
  }

  const title = discovery?.title || url;
  const origin = discovery?.origin ?? "direct_url";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_LIMITS.TIMEOUT_MS);
  let entry: EvidenceSource;
  const noteFailure = (reason: string) => {
    if (ledger && authorityKey) {
      ledger.note(authorityKey, { url, outcome: "failed", reason, at: new Date().toISOString() });
    }
  };
  try {
    const res = await officialFetch(url, { signal: controller.signal });
    if (!res.ok) {
      entry = await store.append({
        url,
        title,
        origin,
        fetch_status: "error",
        fetch_error: `http_${res.status}`,
        extracted_text: "",
        is_actual_document: false,
        not_document_reason: `http_${res.status}`,
      });
      noteFailure(`http_${res.status}`);
      return clampFetchOutput({
        ok: false,
        source_id: entry.source_id,
        error: `http_${res.status}`,
        acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
      });
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > FETCH_LIMITS.MAX_BYTES) {
      entry = await store.append({
        url,
        title,
        origin,
        fetch_status: "error",
        fetch_error: "document_too_large",
        extracted_text: "",
        is_actual_document: false,
        not_document_reason: "document_too_large",
      });
      noteFailure("document_too_large");
      return clampFetchOutput({ ok: false, source_id: entry.source_id, error: "document_too_large" });
    }
    const { text, error } = await extractByContentType(
      url,
      res.headers.get("content-type") ?? "",
      buf,
    );
    const clipped = text.slice(0, FETCH_LIMITS.MAX_TEXT_CHARS);
    const docCheck = checkIsActualDocument(clipped);
    entry = await store.append({
      url,
      title,
      origin,
      fetch_status: error ? "error" : "ok",
      fetch_error: error,
      extracted_text: clipped,
      is_actual_document: !error && docCheck.is_actual_document,
      not_document_reason: error ?? docCheck.reason,
    });
    if (error) {
      noteFailure(error);
      return clampFetchOutput({
        ok: false,
        source_id: entry.source_id,
        error,
        acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    entry = await store.append({
      url,
      title,
      origin,
      fetch_status: "error",
      fetch_error: msg.slice(0, 200),
      extracted_text: "",
      is_actual_document: false,
      not_document_reason: "fetch_exception",
    });
    noteFailure(msg.slice(0, 120));
    return clampFetchOutput({
      ok: false,
      source_id: entry.source_id,
      error: msg.slice(0, 200),
      acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
    });
  } finally {
    clearTimeout(timer);
  }

  const expectedDocket = input.expected_identity?.docket?.trim();
  let identity_hint: string | undefined;

  // Positive corroboration: the fetched BODY must present itself as the
  // requested authority before it may occupy that authority key. A requested
  // label or a merely readable body is never proof.
  const corroboration = corroborateAuthority({
    expected: input.expected_identity,
    title: entry.title,
    text: entry.extracted_text,
    identity_fields: entry.identity_fields,
    is_actual_document: entry.is_actual_document,
  });

  if (expectedDocket) {
    identity_hint = corroboration.corroborated
      ? `התיק ${expectedDocket} מופיע בגוף המסמך שהובא.`
      : `אזהרה: התיק ${expectedDocket} לא נמצא בגוף המסמך שהובא — ככל הנראה זה אינו המסמך המבוקש.`;
  } else if (input.expected_identity?.statute?.trim() && !corroboration.corroborated && entry.is_actual_document) {
    identity_hint =
      `אזהרה: גוף המסמך שהובא אינו מזדהה כ"${input.expected_identity.statute.trim()}" (${corroboration.basis}). ניתן להשתמש בו ככל שהוא רלוונטי, אך הוא אינו נחשב לגוף האסמכתה המבוקשת — אפשר וכדאי להביא מועמד אחר עבורה.`;
  }

  let authority_binding_created = false;
  let authority_binding_withheld = false;
  if (ledger && authorityKey) {
    const bind = corroboration.corroborated;
    const outcome: "acquired" | "failed" | "not_the_document" | "readable_unconfirmed_identity" = bind
      ? "acquired"
      : !entry.is_actual_document
      ? "failed"
      : corroboration.basis === "docket_absent_from_body"
      ? "not_the_document"
      : "readable_unconfirmed_identity";
    authority_binding_created = bind;
    authority_binding_withheld = !bind && entry.is_actual_document;
    ledger.note(
      authorityKey,
      {
        url,
        outcome,
        reason: bind
          ? `body_identity_corroborated:${corroboration.basis}`
          : (entry.not_document_reason ?? corroboration.basis),
        at: new Date().toISOString(),
        identity_corroborated: bind,
      },
      bind ? entry.source_id : undefined,
    );
  }

  const freshWindows = entry.is_actual_document
    ? (input.find?.length
      ? readingWindows(entry.extracted_text, input.find)
      : [entry.extracted_text.slice(0, FETCH_LIMITS.HEAD_CHARS)])
    : undefined;
  const freshServed = serveExactText(store, entry.source_id, freshWindows, input.query ?? input.find?.[0]);

  return clampFetchOutput({
    ok: true,
    source_id: entry.source_id,
    title: entry.title,
    summary: entry.summary,
    text_length: entry.text_length,
    is_actual_document: entry.is_actual_document,
    not_document_reason: entry.not_document_reason,
    identity_found: entry.identity_fields,
    identity_hint,
    authority_identity_corroborated: authorityKey ? corroboration.corroborated : undefined,
    authority_binding_created: authorityKey ? authority_binding_created : undefined,
    authority_binding_withheld: authorityKey ? authority_binding_withheld : undefined,
    authority_binding_basis: authorityKey ? corroboration.basis : undefined,
    text_head: freshServed.windows?.length
      ? undefined
      : entry.extracted_text.slice(0, FETCH_LIMITS.HEAD_CHARS),
    windows: freshServed.windows,
    exact_source_text: freshServed.exact_source_text,
    instruction:
      `הגוף המלא שמור בצד השרת. לקריאת קטע נוסף מתוכו: fetch({source_id, query}) — אל תביא את אותו URL שוב.${
        freshServed.windows?.length ? QUOTE_RULE : ""
      }`,
    acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
  });
}
