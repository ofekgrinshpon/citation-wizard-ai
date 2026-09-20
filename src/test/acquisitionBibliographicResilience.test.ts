/**
 * acquisition_bibliographic_authority_resilience_v1
 *
 * Deterministic coverage for the three tracks:
 *   B — bibliographic fail-safe (no confidently wrong author/title, no raw
 *       URL inside a structured academic citation, no API endpoint cited);
 *   A — acquisition failure taxonomy and bounded same-work recovery;
 *   C — exact-authority resilience helpers.
 */

import { describe, expect, it } from "vitest";
import {
  bibliographicFromSearch,
  formatAcademicCitation,
  isDiscoveryEndpointUrl,
  isGarbageAuthorValue,
  isGarbageTitleValue,
  mergeBibliographic,
  parseHtmlBibliographic,
  parsePdfInfoMetadata,
  sanitizeBibliographic,
} from "../../supabase/functions/legal-research-v2/shared/bibliographic.ts";
import { formatCitation } from "../../supabase/functions/legal-research-v2/drafting/render.ts";
import {
  classifyFetchException,
  classifyHttpStatus,
  classifyUnusableBody,
  isRecoverableFailure,
} from "../../supabase/functions/legal-research-v2/shared/fetchDiagnostics.ts";
import {
  buildAlternativeCopyQuery,
  isAcceptableAlternativeHost,
  isSameWork,
} from "../../supabase/functions/legal-research-v2/tools/alternativeCopy.ts";
import { locateSection } from "../../supabase/functions/legal-research-v2/evidence/sectionLocator.ts";

describe("B — bibliographic fail-safe", () => {
  it("B1: a statute never acquires a personal author from PDF metadata", () => {
    const meta = sanitizeBibliographic(
      parsePdfInfoMetadata({ Title: "חוק יסוד: כבוד האדם וחירותו", Author: "ארבל אסטרחן" }),
      { kind: "statute" },
    );
    expect(meta?.authors ?? []).toHaveLength(0);
    expect(formatAcademicCitation(meta, "חוק יסוד: כבוד האדם וחירותו")).toBeNull();
  });

  it("B2: a mojibake/hex PDF title is rejected", () => {
    expect(isGarbageTitleValue("<E7E5F7E420E9F1E5E3>")).toBe(true);
    expect(parsePdfInfoMetadata({ Title: "<E7E5F7E420E9F1E5E3>" })?.title).toBeUndefined();
  });

  it("B3: `pubdat` is never an author", () => {
    expect(isGarbageAuthorValue("pubdat")).toBe(true);
    expect(parsePdfInfoMetadata({ Author: "pubdat" })?.authors).toBeUndefined();
  });

  it("B4: a file path is never a title", () => {
    expect(isGarbageTitleValue("C:\\Working Papers\\11883.wpd")).toBe(true);
    expect(parsePdfInfoMetadata({ Title: "C:\\Working Papers\\11883.wpd" })?.title).toBeUndefined();
  });

  it("B5: a strong HTML title beats a conflicting PDF title", () => {
    const html = parseHtmlBibliographic(
      `<meta name="citation_title" content="Bodily Autonomy and Tattoo Copyright">` +
        `<meta name="citation_author" content="Smith, Jane">` +
        `<meta name="citation_journal_title" content="Marquette Sports Law Review">`,
    );
    const pdf = parsePdfInfoMetadata({ Title: "Microsoft Word - final draft v7", Author: "Dana" });
    const merged = mergeBibliographic(html, pdf);
    expect(merged?.title).toBe("Bodily Autonomy and Tattoo Copyright");
    expect(merged?.authors).toEqual(["Smith, Jane"]);
    expect(merged?.field_basis?.title).toBe("repository_page");
  });

  it("B6: a strong search title beats a garbage PDF title", () => {
    const merged = mergeBibliographic(
      parsePdfInfoMetadata({ Title: "11883.wpd", Author: "pubdat" }),
      bibliographicFromSearch({
        title: "The Costs of Controlling Shareholders",
        published_date: "2005-12-01",
      }),
    );
    expect(merged?.title).toBe("The Costs of Controlling Shareholders");
    expect(merged?.authors).toBeUndefined();
    expect(merged?.field_basis?.title).toBe("search_metadata");
  });

  it("B7: a structured academic citation carries no raw URL in its text", () => {
    const citation = formatCitation({
      display_title: "landing page",
      url: "https://scholarship.law.marquette.edu/cgi/viewcontent.cgi?article=1234&context=sportslaw",
      bibliographic: {
        title: "Bodily Autonomy and Tattoo Copyright",
        authors: ["Smith, Jane"],
        journal: "Marquette Sports Law Review",
        volume: "32",
        year: "2022",
        metadata_basis: ["repository_page"],
      },
    });
    expect(citation).toContain("Bodily Autonomy and Tattoo Copyright");
    expect(citation).not.toContain("http");
  });

  it("B8: a Crossref/OpenAlex search endpoint cannot become a citation", () => {
    expect(isDiscoveryEndpointUrl("https://api.crossref.org/works?query=tattoo")).toBe(true);
    expect(isDiscoveryEndpointUrl("https://api.openalex.org/works?filter=x")).toBe(true);
    const citation = formatCitation({
      display_title: "works",
      url: "https://api.crossref.org/works?query=tattoo+copyright",
      bibliographic: { title: "works", year: "2022", metadata_basis: ["search_metadata"] },
    });
    expect(citation).not.toMatch(/^works/);
  });

  it("keeps a genuine academic citation intact", () => {
    const out = formatAcademicCitation(
      sanitizeBibliographic({
        title: "סבירות ומידתיות",
        authors: ["דפנה ברק-ארז"],
        journal: "משפטים",
        volume: "נא",
        year: "2022",
        metadata_basis: ["repository_page"],
      }, { kind: "journal_article" }),
      "fallback",
    );
    expect(out).toContain("דפנה ברק-ארז");
    expect(out).toContain("(2022)");
  });
});

describe("A — acquisition failure taxonomy", () => {
  it("names specific HTTP causes instead of http_failed", () => {
    expect(classifyHttpStatus(403)).toBe("http_403_forbidden");
    expect(classifyHttpStatus(429)).toBe("http_429_rate_limited");
    expect(classifyHttpStatus(503)).toBe("http_5xx_origin_error");
    expect(isRecoverableFailure("http_403_forbidden")).toBe(true);
  });

  it("separates DNS, TLS, reset and timeout", () => {
    expect(classifyFetchException("failed to lookup address")).toBe("dns_failure");
    expect(classifyFetchException("invalid certificate: handshake failure")).toBe("tls_failure");
    expect(classifyFetchException("connection reset by peer")).toBe("connection_reset");
    expect(classifyFetchException("The signal has been aborted")).toBe("timeout");
  });

  it("separates a login wall, a JS shell and an empty extraction", () => {
    expect(classifyUnusableBody({ text: "Please log in to continue reading" }))
      .toBe("login_or_paywall_challenge");
    expect(classifyUnusableBody({ text: "Enable JavaScript to view this page" }))
      .toBe("javascript_shell");
    expect(classifyUnusableBody({ text: "", is_pdf: true })).toBe("pdf_body_unreadable");
    expect(classifyUnusableBody({ text: "", is_pdf: false })).toBe("empty_extraction");
  });
});

describe("A — same-work recovery", () => {
  const wanted = {
    title: "The Costs of Controlling Shareholders",
    authors: ["Ronald Gilson"],
    year: "2005",
  };

  it("merges another copy only with confirmed identity", () => {
    expect(
      isSameWork(wanted, { title: "The costs of controlling shareholders", authors: ["R. Gilson"] })
        .same_work,
    ).toBe(true);
    expect(isSameWork(wanted, { title: "The Costs of Controlling Shareholders", year: "2005" }).same_work)
      .toBe(true);
  });

  it("rejects an unrelated but similarly titled document", () => {
    const v = isSameWork(wanted, { title: "Controlling Shareholders in Europe: A Survey", year: "2019" });
    expect(v.same_work).toBe(false);
  });

  it("rejects a title-only match with no corroborating field", () => {
    const v = isSameWork(wanted, { title: "The Costs of Controlling Shareholders" });
    expect(v.same_work).toBe(false);
    expect(v.basis).toBe("title_only_insufficient");
  });

  it("never proposes a pirate mirror as an alternative copy", () => {
    expect(isAcceptableAlternativeHost("https://sci-hub.se/10.1000/x")).toBe(false);
    expect(isAcceptableAlternativeHost("https://papers.ssrn.com/abstract=123")).toBe(true);
  });

  it("builds one bounded query naming the work, not the topic", () => {
    const q = buildAlternativeCopyQuery(wanted)!;
    expect(q).toContain('"The Costs of Controlling Shareholders"');
    expect(q).toContain("Ronald Gilson");
    expect(buildAlternativeCopyQuery({ title: "x" })).toBeNull();
  });
});

describe("C — exact authority resilience", () => {
  const statuteBody = [
    "חוק החוזים (חלק כללי), תשל\"ג-1973",
    "11. כללי",
    "הוראות כלליות.",
    "12. תום לב במשא ומתן",
    "(א) במשא ומתן לקראת כריתתו של חוזה חייב אדם לנהוג בדרך מקובלת ובתום לב.",
    "(ב) צד שלא נהג בדרך מקובלת ולא בתום לב חייב לצד השני פיצויים.",
    "13. חוזה למראית עין",
  ].join("\n");

  it("A2: the section is located inside an already acquired parent statute body", () => {
    const found = locateSection(statuteBody, "12", { window: 600 });
    expect(found.found).toBe(true);
    expect(found.windows.join(" ")).toContain("בדרך מקובלת ובתום לב");
  });

  it("A3: a body that does not carry the requested section says so", () => {
    const found = locateSection("חוק אחר לגמרי ללא סעיפים ממוספרים כלל.", "12", { window: 400 });
    expect(found.found).toBe(false);
  });
});
