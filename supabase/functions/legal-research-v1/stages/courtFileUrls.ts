// Deterministic Supreme Court file-URL derivation.
//
// The Israeli Supreme Court decision archive stores every document under a
// derivable path built from the docket number alone:
//
//   docket  ע"א 6821/93
//   serial  6821  → padded to 5 digits → 06821
//   year    93
//   file id = <yy><serial5><suffix>            → 93068210
//   split   = yy | a(3) | b(3)                 → 93 | 068 | 210
//   path    = <Corpus>/<yy>/<b>/<a>/<doc>      → HebrewVerdicts/93/210/068/Z01
//
// Verified against a known-good URL observed in production retrieval:
//   fileName=93046280_Z01.txt&path=EnglishVerdicts/93/280/046/Z01&type=4
//   (ע"א 4628/93 → 93 04628 0 → 93|046|280)
//
// This module is pure: no network, no model calls. It only produces a small,
// bounded list of URLs to probe. The caller MUST validate the downloaded body
// against the requested docket before using it.

import { normalizedDocketId, type DocketRef } from "./docketDetection.ts";

const HOST = "https://supremedecisions.court.gov.il/Home/Download";

/** Docket prefixes whose files live in the Supreme Court archive. */
const SUPREME_PREFIXES = new Set([
  "bagatz",
  "dnbagatz",
  "aa",
  "ap",
  "raa",
  "rap",
  "dna",
  "dnp",
  "bshp",
  "ram",
  "eem",
  "bam",
  "eeam",
]);

export function isSupremeCourtDocket(d: DocketRef): boolean {
  const key = normalizedDocketId(d).split(":")[0];
  return SUPREME_PREFIXES.has(key);
}

interface Parts {
  yy: string;
  a: string;
  b: string;
  id: string;
}

function parts(d: DocketRef, suffix: number): Parts | null {
  const m = String(d.number ?? "").match(/^(\d{1,6})\/(\d{2,4})$/);
  if (!m) return null;
  const serial = m[1];
  if (serial.length > 5) return null;
  const yy = m[2].slice(-2);
  const id = `${yy}${serial.padStart(5, "0")}${suffix}`;
  return { yy, a: id.slice(2, 5), b: id.slice(5, 8), id };
}

/**
 * True when a derived archive URL is expected to serve *text* (Hebrew corpus
 * `type=2`, or an elyon1 `.htm` mirror) rather than a binary document.
 *
 * large_pdf_extraction_preemption_v1: the `type=4` English corpus URL carries a
 * `.txt` fileName but actually serves a multi-megabyte PDF, so the fileName
 * extension must never be used for this decision — only the `type` parameter.
 */
export function isTextEndpointUrl(u: string): boolean {
  const m = String(u).match(/[?&]type=(\d+)/);
  if (m) return m[1] === "2";
  return /\.html?($|[?#])/i.test(String(u));
}

/**
 * Bounded list of candidate document URLs for a docket.
 *
 * Text endpoints are returned first (stable within their group): synchronous
 * binary extraction is the CPU sink that kills the isolate, so a plain-text
 * body must always be attempted before a PDF one.
 */
function allDerivedUrls(d: DocketRef): string[] {
  if (!isSupremeCourtDocket(d)) return [];
  const urls: string[] = [];
  for (const suffix of [0, 1]) {
    const p = parts(d, suffix);
    if (!p) break;
    const seg = `${p.yy}/${p.b}/${p.a}`;
    urls.push(
      `${HOST}?fileName=${p.id}_Z01.txt&path=HebrewVerdicts/${seg}/Z01&type=2`,
      `${HOST}?fileName=${p.id}_Z01.txt&path=EnglishVerdicts/${seg}/Z01&type=4`,
      `${HOST}?fileName=${p.id}.z01&path=HebrewVerdicts/${seg}/z01&type=2`,
      `https://elyon1.court.gov.il/files/${seg}/z01/${p.id}.z01.htm`,
    );
  }
  return urls;
}

export function deriveSupremeCourtFileUrls(
  d: DocketRef,
  opts: { maxUrls?: number } = {},
): string[] {
  const urls = allDerivedUrls(d);
  const max = opts.maxUrls ?? 6;
  const text = urls.filter(isTextEndpointUrl);
  const binary = urls.filter((u) => !isTextEndpointUrl(u));
  return [...text, ...binary].slice(0, max);
}

/**
 * type4_last_resort_probe_v1 — the binary/corpus (`type=4`) derived URLs only.
 *
 * Production logs prove this endpoint is the one that actually serves judgment
 * bodies for Supreme Court dockets, while the text (`type=2` / elyon1) slice
 * frequently returns a short WAF block page. Callers probe these *after* every
 * text endpoint has failed, behind the existing PDF preflight and byte caps.
 */
export function deriveSupremeCourtBinaryUrls(
  d: DocketRef,
  opts: { maxUrls?: number } = {},
): string[] {
  return allDerivedUrls(d)
    .filter((u) => !isTextEndpointUrl(u))
    .slice(0, opts.maxUrls ?? 1);
}


