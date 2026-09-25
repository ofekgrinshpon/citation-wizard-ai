/**
 * scholarly_acquisition_resilience_v1 — generic landing-page document
 * discovery, original-work identity enrichment and bounded multi-candidate
 * same-work recovery. No host-specific code; trust gates unchanged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../../supabase/functions/legal-research-v2/types.ts";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore.ts";
import { runFetch } from "../../supabase/functions/legal-research-v2/tools/fetch.ts";
import {
  documentLinksFromHtml,
  MAX_LANDING_DOCUMENT_CANDIDATES,
} from "../../supabase/functions/legal-research-v2/shared/bibliographic.ts";
import {
  buildSameWorkQueries,
  buildTrustedWorkIdentity,
  recoverSameWork,
  SAME_WORK_RECOVERY_LIMITS,
} from "../../supabase/functions/legal-research-v2/tools/sameWorkRecovery.ts";

const TITLE = "Digital Exhaustion and the Resale of Copyrighted Works";
const PROSE = Array.from({ length: 120 }, (_, i) =>
  `Paragraph ${i}: The doctrine of exhaustion limits the copyright owner's control after the first authorized sale, and courts have debated whether a digital transfer creates a new reproduction rather than a distribution of the lawfully made copy.`,
).join("\n\n");
const ARTICLE_HTML = `<html><body><article>${PROSE.split("\n\n").map((p) => `<p>${p}</p>`).join("")}</article></body></html>`;

/** Minimal valid text PDF so the ordinary PDF extractor reads a real body. */
function makePdf(lines: string[]): string {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => "\\" + c);
  const content = "BT /F1 9 Tf 20 800 Td 11 TL " + lines.map((l) => `(${esc(l)}) '`).join(" ") + " ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return out;
}
const ARTICLE_PDF = makePdf(PROSE.split("\n\n").slice(0, 70).map((p) => p.slice(0, 120)));

let n = 0;
const result = (p: Partial<SearchResult>): SearchResult =>
  ({ result_id: `S${++n}`, title: "", origin: "perplexity:raw_web", ...p }) as SearchResult;

function mockFetch(routes: Record<string, { status?: number; body: string; ct?: string }>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response("not found", { status: 404 });
    const res = new Response(r.body, { status: r.status ?? 200, headers: { "content-type": r.ct ?? "text/html" } });
    Object.defineProperty(res, "url", { value: url });
    return res;
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const landing = (extra: string) =>
  `<html><head><meta name="citation_title" content="${TITLE}"><meta name="citation_author" content="Noa Levin"><meta name="citation_publication_date" content="2019"></head><body><h1>${TITLE}</h1><p>Abstract only.</p>${extra}<a href="/privacy.pdf">Privacy policy</a></body></html>`;

describe("landing-page document discovery", () => {
  it("T1 citation_pdf_url is still preferred and followed", async () => {
    const page = "https://repo.example.edu/item/7";
    mockFetch({
      [page]: { body: landing(`<a href="/other.pdf">PDF</a>`).replace("<head>", `<head><meta name="citation_pdf_url" content="https://repo.example.edu/files/7.pdf">`) },
      "https://repo.example.edu/files/7.pdf": { body: ARTICLE_PDF, ct: "application/pdf" },
    });
    expect(documentLinksFromHtml(landing("").replace("<head>", `<head><meta name="citation_pdf_url" content="/files/7.pdf">`), page)[0])
      .toBe("https://repo.example.edu/files/7.pdf");
    const store = new EvidenceStore();
    const out = await runFetch(store, new Map(), { url: page });
    expect(out.ok).toBe(true);
    expect(out.repository_pdf_followed).toBe(true);
    expect(out.is_actual_document).toBe(true);
    expect(store.all().length).toBe(1);
    expect(store.all()[0].bibliographic?.authors?.[0]).toMatch(/Levin/);
  });

  it("T2 a generic relative PDF link is discovered and fetched without citation_pdf_url", async () => {
    const page = "https://journal.example.org/articles/42";
    mockFetch({
      [page]: { body: landing(`<a href="../downloads/42.pdf">Download PDF</a>`) },
      "https://journal.example.org/downloads/42.pdf": { body: ARTICLE_PDF, ct: "application/pdf" },
    });
    const out = await runFetch(new EvidenceStore(), new Map(), { url: page });
    expect(out.ok).toBe(true);
    expect(out.repository_pdf_followed).toBe(true);
    expect(out.is_actual_document).toBe(true);
    expect(out.landing_document_attempted).toBe(1);
  });

  it("skips site chrome, dedupes and caps candidates", () => {
    const html = `<a href="/policy.pdf">Privacy</a>${Array.from({ length: 8 }, (_, i) => `<a href="/p${i}.pdf">x</a><a href="/p${i}.pdf">y</a>`).join("")}`;
    const links = documentLinksFromHtml(html, "https://a.example.edu/x");
    expect(links.length).toBe(MAX_LANDING_DOCUMENT_CANDIDATES);
    expect(links.some((l) => l.includes("policy"))).toBe(false);
    expect(new Set(links).size).toBe(links.length);
  });
});

describe("original-work identity + multi-candidate recovery", () => {
  it("T3 landing metadata lifts a title-only original out of the dead end", async () => {
    const build = buildTrustedWorkIdentity({
      discovery: { title: TITLE, url: "https://uni.example.ac.il/paper" },
      stored_bibliographic: {
        title: TITLE, authors: ["Noa Levin"], year: "2019",
        field_basis: { title: "repository_page", authors: "repository_page", year: "repository_page" },
        metadata_basis: ["repository_page"],
      },
    });
    expect(build.fields_before).toEqual(["title"]);
    expect(build.fields_after).toEqual(expect.arrayContaining(["authors", "year"]));
    const rec = await recoverSameWork({
      failed_source_identity: build.identity,
      failure_class: "http_403_forbidden",
      already_attempted_urls: ["https://uni.example.ac.il/paper"],
      search: async () => [result({ title: TITLE, url: "https://author.example.com/levin.pdf", published_date: "2019" })],
      acquire: async () => ({ ok: true }),
    });
    expect(rec.recovered).toBe(true);
    // Without enrichment the same candidate would be title-only → rejected.
    const bare = await recoverSameWork({
      failed_source_identity: { title: TITLE },
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [result({ title: TITLE, url: "https://author.example.com/levin.pdf", published_date: "2019" })],
    });
    expect(bare.recovered).toBe(false);
  });

  it("weak (embedded PDF) metadata never joins the trusted identity", () => {
    const b = buildTrustedWorkIdentity({
      discovery: { title: TITLE },
      stored_bibliographic: { authors: ["Someone"], year: "2001", metadata_basis: ["pdf_metadata"], field_basis: { authors: "pdf_metadata", year: "pdf_metadata" } },
    });
    expect(b.identity.authors).toBeUndefined();
    expect(b.identity.year).toBeUndefined();
  });

  it("T4 a similar title with conflicting author/year/DOI is rejected", async () => {
    let acquired = 0;
    const rec = await recoverSameWork({
      failed_source_identity: { title: TITLE, authors: ["Noa Levin"], year: "2019", doi: "10.1000/abc" },
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [result({ title: TITLE, url: "https://x.example.edu/y.pdf", snippet: "Dan Cohen 2011 doi 10.1000/zzz" })],
      acquire: async () => { acquired++; return { ok: true }; },
    });
    expect(rec.recovered).toBe(false);
    expect(acquired).toBe(0);
  });

  it("T5 first equivalent copy fails, second succeeds", async () => {
    const tried: string[] = [];
    const rec = await recoverSameWork({
      failed_source_identity: { title: TITLE, year: "2019" },
      failure_class: "timeout",
      already_attempted_urls: [],
      search: async () => [
        result({ title: TITLE, url: "https://a.example.edu/1.pdf", published_date: "2019" }),
        result({ title: TITLE, url: "https://b.example.edu/2.pdf", published_date: "2019" }),
      ],
      acquire: async (c) => { tried.push(c.url!); return tried.length === 1 ? { ok: false, failure_class: "http_403_forbidden" } : { ok: true }; },
    });
    expect(rec.recovered).toBe(true);
    expect(rec.candidate?.url).toContain("b.example.edu");
    expect(rec.telemetry.candidate_fetch_failures).toEqual(["http_403_forbidden"]);
  });

  it("T6 bounded exhaustion: caps respected, dead URLs never retried, clear reason", async () => {
    let searches = 0;
    const tried: string[] = [];
    const rec = await recoverSameWork({
      failed_source_identity: { title: TITLE, authors: ["Noa Levin"], year: "2019", doi: "10.1000/abc" },
      failure_class: "timeout",
      already_attempted_urls: ["https://dead.example.edu/x.pdf"],
      search: async () => {
        searches++;
        return [
          result({ title: TITLE, url: "https://dead.example.edu/x.pdf", snippet: "10.1000/abc" }),
          ...Array.from({ length: 5 }, (_, i) => result({ title: TITLE, url: `https://m${i}.example.edu/p.pdf`, snippet: "doi 10.1000/abc" })),
        ];
      },
      acquire: async (c) => { tried.push(c.url!); return { ok: false, failure_class: "connection_reset" }; },
    });
    expect(rec.recovered).toBe(false);
    expect(rec.reason).toBe("equivalent_copies_failed_acquisition");
    expect(tried.length).toBe(SAME_WORK_RECOVERY_LIMITS.MAX_CANDIDATE_FETCH_ATTEMPTS);
    expect(tried).not.toContain("https://dead.example.edu/x.pdf");
    expect(new Set(tried).size).toBe(tried.length);
    expect(searches).toBeLessThanOrEqual(SAME_WORK_RECOVERY_LIMITS.MAX_QUERIES_PER_WORK);
  });

  it("query ladder names the work only, deduped and capped", () => {
    const qs = buildSameWorkQueries({ title: TITLE, authors: ["Noa Levin"], year: "2019", doi: "10.1/x" });
    expect(qs.length).toBe(3);
    expect(qs[0]).toBe('"10.1/x"');
    expect(qs.every((q) => q.includes(TITLE) || q.includes("10.1/x"))).toBe(true);
  });

  it("T7 metadata identifies the work but never becomes evidence", async () => {
    const page = "https://blocked.example.edu/item";
    mockFetch({ [page]: { body: landing("") } });
    const store = new EvidenceStore();
    const out = await runFetch(store, new Map(), { url: page });
    expect(out.is_actual_document).toBe(false);
    const entry = store.get(out.source_id!)!;
    expect(entry.bibliographic?.authors?.length).toBeGreaterThan(0);
    expect(store.readable().length).toBe(0);
    const rec = await recoverSameWork({
      failed_source_identity: buildTrustedWorkIdentity({ discovery: { title: TITLE, url: page }, stored_bibliographic: entry.bibliographic }).identity,
      failure_class: "landing_page_not_document",
      already_attempted_urls: [page],
      search: async () => [],
    });
    expect(rec.recovered).toBe(false);
    expect(store.readable().length).toBe(0);
  });
});
