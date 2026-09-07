import { describe, expect, it } from "vitest";
import {
  partyTokensFromTitle,
  selectWebJudgmentCandidate,
} from "../../supabase/functions/legal-research-v1/stages/webJudgmentBodyAcquisition.ts";

type AnyCandidate = Parameters<typeof selectWebJudgmentCandidate>[0];

function cand(over: Record<string, unknown>): AnyCandidate {
  return {
    candidate_id: "c1",
    title: `בג"צ 1000/92 - חוה בבלי נ' בית הדין הרבני הגדול`,
    snippet: "",
    source_url: "https://judgments.org.il/judgments/bagatz-1000-92/",
    source_type: "court_case",
    role: "binding_case_law",
    origin: "web",
    metadata: { source_integrity: { citable_as: "judgment" } },
    ...over,
  } as unknown as AnyCandidate;
}

describe("web_judgment_body_wiring_v1 — candidate selection", () => {
  it("admits a docket-bearing judgment on a non-official host", () => {
    const s = selectWebJudgmentCandidate(cand({}));
    expect(s.eligible).toBe(true);
    expect(s.docket?.number).toContain("1000/92");
  });

  it("admits the daat.ac.il page for the same judgment", () => {
    const s = selectWebJudgmentCandidate(
      cand({ candidate_id: "c2", source_url: "https://www.daat.ac.il/daat/maamar.asp?id=151" }),
    );
    expect(s.eligible).toBe(true);
  });

  it("leaves court hosts to the canonical/relay lane", () => {
    const s = selectWebJudgmentCandidate(
      cand({ source_url: "https://supremedecisions.court.gov.il/Home/Download?path=x.pdf" }),
    );
    expect(s.eligible).toBe(false);
    expect(s.reason).toBe("court_host_out_of_scope");
  });

  it("refuses paywalled/access-controlled URLs", () => {
    const s = selectWebJudgmentCandidate(
      cand({ source_url: "https://www.nevo.co.il/psika_html/elyon/1000-92.htm" }),
    );
    expect(s.eligible).toBe(false);
    expect(s.reason).toBe("paywalled_or_access_controlled");
  });

  it("fails closed with no docket identity", () => {
    const s = selectWebJudgmentCandidate(
      cand({ title: "ארכיון הלכת בבלי", source_url: "https://example.org/archive" }),
    );
    expect(s.eligible).toBe(false);
    expect(s.reason).toBe("no_docket_identity");
  });

  it("does not upgrade a generic article that only name-drops a judgment", () => {
    const s = selectWebJudgmentCandidate(
      cand({
        title: "רשימה על חלוקת רכוש בין בני זוג",
        source_url: "https://example.ac.il/papers/property.html",
        snippet: `ראו בג"צ 1000/92`,
        source_type: "academic",
        metadata: { source_integrity: { citable_as: "commentary" } },
      }),
    );
    expect(s.eligible).toBe(false);
    expect(s.reason).toBe("not_judgment_class");
  });

  it("integrity-downgraded commentary page with docket identity may be probed", () => {
    const s = selectWebJudgmentCandidate(
      cand({
        source_type: "academic",
        source_url: "https://www.daat.ac.il/daat/maamar.asp?id=151",
        snippet: `פסק דין בבית המשפט העליון בשבתו כבית דין גבוה לצדק`,
        metadata: {
          source_integrity: {
            citable_as: "commentary",
            authority_tier: "secondary_commentary",
            text_usability: "metadata_only",
          },
        },
      }),
    );
    expect(s.eligible).toBe(true);
    expect(s.identity_backed_probe).toBe(true);
    expect(s.probe_signals?.length).toBeGreaterThanOrEqual(2);
  });

  it("probe refuses listing pages", () => {
    const s = selectWebJudgmentCandidate(
      cand({
        source_type: "academic",
        metadata: {
          source_integrity: { citable_as: "commentary", text_usability: "listing_page" },
        },
      }),
    );
    expect(s.eligible).toBe(false);
    expect(s.reason).toBe("listing_like");
  });

  it("probe refuses a rejected bad source", () => {
    const s = selectWebJudgmentCandidate(
      cand({
        source_type: "academic",
        metadata: {
          source_integrity: { citable_as: "commentary", reject: true, reject_reason: "metadata_only" },
        },
      }),
    );
    expect(s.eligible).toBe(false);
    expect(s.reason).toBe("bad_source");
  });

  it("probe never applies on a court host", () => {
    const s = selectWebJudgmentCandidate(
      cand({
        source_type: "academic",
        source_url: "https://supremedecisions.court.gov.il/Home/Download?path=x.pdf",
        metadata: { source_integrity: { citable_as: "commentary" } },
      }),
    );
    expect(s.reason).toBe("court_host_out_of_scope");
  });

  it("skips candidates that already carry a judgment body", () => {
    const s = selectWebJudgmentCandidate(
      cand({
        metadata: {
          source_integrity: { citable_as: "judgment" },
          judgment_text_acquired: true,
        },
      }),
    );
    expect(s.eligible).toBe(false);
    expect(s.reason).toBe("body_already_acquired");
  });

  it("extracts party tokens from a Hebrew case title", () => {
    const toks = partyTokensFromTitle(`בג"צ 1000/92 - חוה בבלי נ' בית הדין הרבני הגדול`);
    expect(toks).toContain("בבלי");
    expect(toks.length).toBeGreaterThanOrEqual(2);
  });
});
