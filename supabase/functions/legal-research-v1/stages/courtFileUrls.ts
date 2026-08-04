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
 * Bounded list of candidate document URLs for a docket (Hebrew corpus first,
 * then English, then the legacy elyon1 mirror).
 */
export function deriveSupremeCourtFileUrls(
  d: DocketRef,
  opts: { maxUrls?: number } = {},
): string[] {
  if (!isSupremeCourtDocket(d)) return [];
  const max = opts.maxUrls ?? 6;
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
  return urls.slice(0, max);
}
