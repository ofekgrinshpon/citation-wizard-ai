import { describe, expect, it } from "vitest";
import {
  classifyLocalCaselawBody,
  enrichLocalCaselawListingGate,
  GATE_META_KEY,
  hasCollectorShapedUrl,
  isLocalCaselawCandidate,
} from "../../supabase/functions/legal-research-v1/stages/localCaselawListingGate.ts";
import { classifyDiscoveryPrecision } from "../../supabase/functions/legal-research-v1/stages/discoveryPrecision.ts";

const judgmentBody =
  `לפני כבוד השופט הישאם שבאיטה\nתובע פלוני נגד נתבעת אלמונית\nפסק דין\nעסקינן בתביעה ${"א".repeat(3000)}`;

const cand = (over: Record<string, unknown> = {}) =>
  ({
    candidate_id: "c1",
    claim_id: "cl1",
    role: "binding_case_law",
    origin: "local_db",
    document_id: "11111111-1111-1111-1111-111111111111",
    retrieval_method: "text",
    title: "פסק דין",
    source_type: "caselaw",
    source_url: "https://www.gov.il/he/dynamiccollectors/spokmanship_court?skip=120",
    snippet: judgmentBody.slice(0, 500),
    query_he: "q",
    score: 1,
    ...over,
  }) as never;

const rpc = (rows: unknown[]) => ({
  rpc: async () => ({ data: rows, error: null }),
});

describe("local_caselaw_content_aware_listing_gate_v1", () => {
  it("recognises local caselaw candidates and collector URLs", () => {
    expect(isLocalCaselawCandidate(cand())).toBe(true);
    expect(isLocalCaselawCandidate(cand({ origin: "perplexity" }))).toBe(false);
    expect(hasCollectorShapedUrl("https://x.gov.il/dynamiccollectors/a?skip=30")).toBe(true);
    expect(hasCollectorShapedUrl("https://x.gov.il/departments/legalInfo/case-1")).toBe(false);
  });

  it("classifies a substantive judgment body", () => {
    const v = classifyLocalCaselawBody({
      title: "פסק דין",
      text: judgmentBody,
      case_number: "12345-01-24",
      body_chars: 22000,
    });
    expect(v.classification).toBe("substantive_judgment_body");
  });

  it("classifies an official abridged summary as partial", () => {
    const v = classifyLocalCaselawBody({
      title: "תקציר פסק דין",
      text: `תקציר פסק דין\nלפני כבוד השופטת פלונית\nהחלטה ${"ב".repeat(1200)}`,
      case_number: "9/24",
      body_chars: 1300,
    });
    expect(v.classification).toBe("partial_judgment_summary");
  });

  it("keeps real listing bodies suppressed", () => {
    const listing = "תוצאות חיפוש לצפייה לצפייה לצפייה עמוד הבא לצפייה תוצאות נוספות";
    const v = classifyLocalCaselawBody({
      title: "ארכיון פסיקה",
      text: listing.repeat(20),
      case_number: null,
      body_chars: 4000,
    });
    expect(v.classification).toBe("listing_or_index_body");
  });

  it("keeps metadata-only rows out", () => {
    const v = classifyLocalCaselawBody({
      title: "פס\"ד תביעה לפירוק שיתוף",
      text: "ביהמ\"ש לענייני משפחה בצפת: פס\"ד תביעה לפירוק שיתוף",
      case_number: null,
      body_chars: 214,
    });
    expect(v.classification).toBe("metadata_only");
  });

  it("bypasses URL listing suppression for verified local judgments only", async () => {
    const c = cand();
    const diag = await enrichLocalCaselawListingGate(
      rpc([{
        document_id: "11111111-1111-1111-1111-111111111111",
        case_number: "12345-01-24",
        body_chars: 22000,
        head_text: judgmentBody,
      }]),
      [c] as never,
    );
    expect(diag.candidates_checked).toBe(1);
    expect(diag.bypassed).toBe(1);
    const meta = (c as unknown as { metadata: Record<string, unknown> }).metadata;
    expect((meta[GATE_META_KEY] as { bypass: boolean }).bypass).toBe(true);

    const p = classifyDiscoveryPrecision({ candidate: c, task_intent: "broad_research" } as never);
    expect(p.suppress).toBe(false);
    expect(p.protection_reason).toBe("local_caselaw_substantive_body");
  });

  it("leaves web/perplexity candidates untouched", async () => {
    const web = cand({ origin: "perplexity", document_id: null });
    const diag = await enrichLocalCaselawListingGate(rpc([]), [web] as never);
    expect(diag.candidates_checked).toBe(0);
    expect(
      (web as unknown as { metadata?: Record<string, unknown> }).metadata?.[GATE_META_KEY],
    ).toBeUndefined();
  });

  it("never throws when the RPC fails", async () => {
    const diag = await enrichLocalCaselawListingGate(
      { rpc: async () => ({ data: null, error: { message: "boom" } }) },
      [cand()] as never,
    );
    expect(diag.status).toBe("completed");
    expect(diag.rpc_error).toBe("boom");
  });
});
