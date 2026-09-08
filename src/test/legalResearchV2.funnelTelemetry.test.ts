/**
 * v2_identity_track_cleanup_keep_observability_v1
 *
 * The verification funnel must report the stage where evidence ACTUALLY died.
 * Final-pack membership is never a proxy for an earlier stage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const supportMock = vi.fn();
vi.mock("../../supabase/functions/legal-research-v2/verification/supportVerifier", () => ({
  verifySupport: (...args: unknown[]) => supportMock(...args),
}));

import { verifyMemo } from "../../supabase/functions/legal-research-v2/verification/verify";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import type { ResearchMemo } from "../../supabase/functions/legal-research-v2/types";

const BODY = `בבית המשפט העליון בשבתו כבית משפט גבוה לצדק
בג"ץ 1234/20 פלוני נגד היועץ המשפטי לממשלה

${
  "בית המשפט קבע כי חובת ההנמקה של רשות מנהלית היא חובה עצמאית, ואין די בהפניה כללית לשיקולי מדיניות. ".repeat(
    8,
  )
}`;

const usage = { add: () => {} } as never;

async function storeWith(title: string, text: string) {
  const store = new EvidenceStore();
  const src = await store.append({
    url: "https://example.gov.il/doc",
    title,
    origin: "test",
    fetch_status: "ok",
    extracted_text: text,
    is_actual_document: true,
  });
  return { store, src };
}

function memo(span: string): ResearchMemo {
  return {
    issue_summary: "בדיקה",
    claims: [
      {
        claim_id: "C1",
        proposition: "חובת ההנמקה היא חובה עצמאית.",
        importance: "core",
        evidence: [{ source_id: "S1", quoted_span: span }],
      },
    ],
    unresolved_questions: [],
  } as unknown as ResearchMemo;
}

describe("verification funnel telemetry", () => {
  beforeEach(() => {
    supportMock.mockReset();
    supportMock.mockResolvedValue({ verdicts: [] });
  });

  it("A. a span rejection is reported as a span rejection, not identity", async () => {
    const { store } = await storeWith('בג"ץ 1234/20 פלוני נגד היועץ המשפטי לממשלה', BODY);
    const out = await verifyMemo({
      memo: memo("נוסח שלא קיים כלל בגוף המסמך ואין לו זכר בטקסט המאוחסן הזה"),
      store,
      expected: { dockets: ['בג"ץ 1234/20'], statutes: [] },
      model: "m",
      usage,
    });
    expect(out.rejected[0].stage).toBe("span");
    expect(out.rejected[0].reason).toBe("span_not_found");
    expect(out.per_source?.S1.identity).toBe(true);
    expect(out.per_source?.S1.span).toBe(false);
    expect(out.per_source?.S1.terminal_stage).toBe("span");
  });

  it("B. an identity rejection is still reported as an identity rejection", async () => {
    // Pre-existing identity semantics: the document presents itself as the
    // expected statute, but the required section is absent from the body.
    const { store } = await storeWith(
      "חוק יחסי ממון בין בני זוג",
      "חוק יחסי ממון בין בני זוג. " + "הוראות כלליות בדבר הסדר איזון המשאבים בין בני זוג. ".repeat(30),
    );
    const out = await verifyMemo({
      memo: memo("הוראות כלליות בדבר הסדר איזון המשאבים בין בני זוג"),
      store,
      expected: {
        dockets: [],
        statutes: [{ statute: "חוק יחסי ממון בין בני זוג", section: "5א" }],
      },
      model: "m",
      usage,
    });
    expect(out.rejected[0].stage).toBe("identity");
    expect(out.rejected[0].reason).toBe("identity_mismatch");
    expect(out.per_source?.S1.identity).toBe(false);
    expect(out.per_source?.S1.readable).toBe(true);
    expect(out.per_source?.S1.terminal_stage).toBe("identity");
  });

  it("C. a support rejection is attributed to support", async () => {
    const span = "חובת ההנמקה של רשות מנהלית היא חובה עצמאית, ואין די בהפניה כללית לשיקולי מדיניות";
    const { store } = await storeWith('בג"ץ 1234/20 פלוני נגד היועץ המשפטי לממשלה', BODY);
    supportMock.mockImplementation(async (pairs: Array<{ pair_id: string }>) => ({
      verdicts: pairs.map((p) => ({
        pair_id: p.pair_id,
        support: "does_not_support",
        reason: "הציטוט אינו תומך בטענה",
      })),
    }));
    const out = await verifyMemo({
      memo: memo(span),
      store,
      expected: { dockets: ['בג"ץ 1234/20'], statutes: [] },
      model: "m",
      usage,
    });
    expect(out.rejected[0].stage).toBe("support");
    expect(out.rejected[0].reason).toBe("support_does_not_support");
    expect(out.per_source?.S1).toMatchObject({
      readable: true,
      identity: true,
      span: true,
      support: false,
      terminal_stage: "support",
      rejection_code: "support_does_not_support",
    });
  });

  it("D. earlier stages are not inferred from final-pack membership", async () => {
    const { store } = await storeWith('בג"ץ 1234/20 פלוני נגד היועץ המשפטי לממשלה', BODY);
    const out = await verifyMemo({
      memo: memo("נוסח שלא קיים כלל בגוף המסמך ואין לו זכר בטקסט המאוחסן הזה"),
      store,
      expected: { dockets: ['בג"ץ 1234/20'], statutes: [] },
      model: "m",
      usage,
    });
    // Nothing reached the pack, yet identity is still reported as passed.
    expect(out.pack.claims).toHaveLength(0);
    expect(out.per_source?.S1.identity).toBe(true);
    expect(out.per_source?.S1.support).toBe(false);
    expect(out.counters.identity_verified_pairs).toBe(1);
    expect(out.counters.span_verified_pairs).toBe(0);
  });
});
