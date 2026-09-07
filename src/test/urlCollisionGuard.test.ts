import { describe, expect, it } from "vitest";
import {
  collisionIdentity,
  queryDifferences,
  resolveUrlCollision,
} from "../../supabase/functions/legal-research-v1/stages/urlCollisionGuard.ts";

const c = (
  id: string,
  title: string,
  url: string,
  extra: Partial<{ snippet: string; metadata: Record<string, unknown> }> = {},
) => ({ candidate_id: id, title, source_url: url, ...extra });

describe("query_sensitive_document_dedupe_v1", () => {
  it("A. same endpoint, different document ids and different dockets → distinct", () => {
    const a = c("a", 'בג"ץ 1000/92 בבלי נ\' בית הדין הרבני הגדול', "https://www.daat.ac.il/daat/maamar.asp?id=101");
    const b = c("b", 'בג"ץ 8638/03 סימה אמיר נ\' בית הדין הרבני', "https://www.daat.ac.il/daat/maamar.asp?id=202");
    const r = resolveUrlCollision(a, b);
    expect(r.decision).toBe("preserve_distinct");
    expect(r.reason).toBe("docket_disagreement");
  });

  it("B. different query ids and materially different legal titles, no docket → distinct", () => {
    const a = c("a", "חלוקת רכוש בין בני זוג לאחר גירושין הלכה ומעשה", "https://x.org/doc?id=1");
    const b = c("b", "מעמד ההסכם הקיבוצי בפסיקת בית הדין הארצי לעבודה", "https://x.org/doc?id=2");
    const r = resolveUrlCollision(a, b);
    expect(r.decision).toBe("preserve_distinct");
    expect(r.reason).toMatch(/document_id_param_and_title_divergence/);
  });

  it("C. same judgment with an added tracking param → collapse", () => {
    const a = c("a", 'בג"ץ 1000/92 בבלי', "https://x.org/doc?id=101");
    const b = c("b", 'בג"ץ 1000/92 בבלי', "https://x.org/doc?id=101&utm_source=x");
    const r = resolveUrlCollision(a, b);
    expect(r.decision).toBe("collapse");
    expect(r.query_differences).toEqual([]);
  });

  it("D. tracking-only differences → collapse", () => {
    const a = c("a", "מאמר על סבירות", "https://x.org/doc?utm_source=a");
    const b = c("b", "מאמר על סבירות", "https://x.org/doc?utm_source=b&fbclid=9");
    expect(queryDifferences(a.source_url, b.source_url)).toEqual([]);
    expect(resolveUrlCollision(a, b).decision).toBe("collapse");
  });

  it("E. query differs but no identity evidence → conservative collapse", () => {
    const a = c("a", "עמוד מידע", "https://x.org/doc?page=1");
    const b = c("b", "עמוד מידע נוסף", "https://x.org/doc?page=2");
    const r = resolveUrlCollision(a, b);
    expect(r.decision).toBe("collapse");
    expect(r.reason).toBe("insufficient_identity_evidence");
  });

  it("F. two different authorities are never collapsed on URL-key equality alone", () => {
    const a = c("a", "פסק דין א", "https://x.org/doc?id=1", {
      metadata: { authority_id: "hcj-1000-92" },
    });
    const b = c("b", "פסק דין ב", "https://x.org/doc?id=2", {
      metadata: { authority_id: "hcj-8638-03" },
    });
    expect(resolveUrlCollision(a, b).decision).toBe("preserve_distinct");
  });

  it("same docket reached through different query ids still collapses", () => {
    const a = c("a", 'בג"ץ 1000/92 בבלי', "https://x.org/doc?id=1");
    const b = c("b", 'בג״ץ 1000-92 בבלי', "https://x.org/doc?id=2");
    const r = resolveUrlCollision(a, b);
    expect(r.decision).toBe("collapse");
    expect(r.reason).toBe("same_docket_identity");
  });

  it("identity extraction reads dockets and authority ids", () => {
    const i = collisionIdentity(
      c("a", 'בג"ץ 8638/03 סימה אמיר', "https://x.org/d?id=3", {
        metadata: { authority_id: "HCJ-8638-03" },
      }),
    );
    expect(i.docket).toBe("בגץ:8638/03");
    expect(i.authority_id).toBe("hcj-8638-03");
  });
});
