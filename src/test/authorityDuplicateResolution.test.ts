import { describe, it, expect } from "vitest";
import {
  resolveDuplicateRepresentatives,
  usabilityScore,
  type DuplicateSignals,
} from "../../supabase/functions/legal-research-v1/stages/duplicateRepresentative.ts";

type C = { candidate_id: string; title: string; source_url?: string | null };

const thin = (keys: string[]): DuplicateSignals => ({
  keys,
  has_url: true,
  fetchable_url: false,
  exact_identity: false,
  integrity_usable: false,
  has_body: false,
  body_chars: 0,
  snippet_chars: 120,
  listing_like: false,
});

const strong = (keys: string[], bodyChars = 70000): DuplicateSignals => ({
  keys,
  has_url: true,
  fetchable_url: true,
  exact_identity: true,
  integrity_usable: true,
  has_body: bodyChars > 0,
  body_chars: bodyChars,
  snippet_chars: 900,
  listing_like: false,
});

function run(list: C[], map: Record<string, DuplicateSignals>) {
  return resolveDuplicateRepresentatives(list, (c) => map[c.candidate_id]);
}

describe("authority_duplicate_resolution_v1", () => {
  it("picks the fetchable, identity-confirmed judgment over the thin duplicate", () => {
    const list: C[] = [
      { candidate_id: "thin", title: 'בג"ץ 1000/92 בבלי', source_url: "https://x/a" },
      { candidate_id: "full", title: 'בג"ץ 1000/92 בבלי', source_url: "https://daat/b" },
    ];
    const r = run(list, { thin: thin(["dk:1000/92"]), full: strong(["dk:1000/92"]) });
    expect(r.order[0].candidate_id).toBe("full");
    expect(r.reordered).toBe(1);
    expect(r.groups[0].selected_candidate_id).toBe("full");
  });

  it("picks the stronger representation of the same statute section", () => {
    const list: C[] = [
      { candidate_id: "snippet", title: "חוק X סעיף 5", source_url: "https://blog/x" },
      { candidate_id: "official", title: "חוק X סעיף 5", source_url: "https://gov/x" },
    ];
    const r = run(list, {
      snippet: thin(["st:חוק x§5"]),
      official: strong(["st:חוק x§5"], 20000),
    });
    expect(r.order[0].candidate_id).toBe("official");
  });

  it("picks the full-text academic article over its catalogue record", () => {
    const list: C[] = [
      { candidate_id: "catalogue", title: "מאמר על סבירות", source_url: "https://cat/1" },
      { candidate_id: "pdf", title: "מאמר על סבירות", source_url: "https://uni/1.pdf" },
    ];
    const r = run(list, {
      catalogue: thin(["url:cat/1", "tt:scholarship:מאמר על סבירות"]),
      pdf: strong(["url:uni/1.pdf", "tt:scholarship:מאמר על סבירות"], 30000),
    });
    expect(r.order[0].candidate_id).toBe("pdf");
    expect(r.groups).toHaveLength(1);
  });

  it("never collapses or re-ranks two genuinely different authorities", () => {
    const list: C[] = [
      { candidate_id: "weak_a", title: 'בג"ץ 1/11', source_url: "https://a" },
      { candidate_id: "strong_b", title: 'בג"ץ 2/22', source_url: "https://b" },
    ];
    const r = run(list, { weak_a: thin(["dk:1/11"]), strong_b: strong(["dk:2/22"]) });
    expect(r.order.map((c) => c.candidate_id)).toEqual(["weak_a", "strong_b"]);
    expect(r.groups).toHaveLength(0);
    expect(r.reordered).toBe(0);
  });

  it("arrival order does not let a thin duplicate beat a stronger representation", () => {
    const list: C[] = [
      { candidate_id: "first_thin", title: "same doc", source_url: "https://a" },
      { candidate_id: "later_full", title: "same doc", source_url: "https://b" },
    ];
    const r = run(list, {
      first_thin: thin(["doc:42"]),
      later_full: strong(["doc:42"], 8000),
    });
    expect(r.order[0].candidate_id).toBe("later_full");
    expect(usabilityScore(strong(["doc:42"], 8000))).toBeGreaterThan(
      usabilityScore(thin(["doc:42"])),
    );
  });

  it("keeps group positions stable and prefers the earlier record on a tie", () => {
    const s = () => strong(["doc:9"], 10000);
    const list: C[] = [
      { candidate_id: "x", title: "t", source_url: "https://a" },
      { candidate_id: "other", title: "u", source_url: "https://c" },
      { candidate_id: "y", title: "t", source_url: "https://b" },
    ];
    const r = run(list, { x: s(), y: s(), other: thin(["doc:7"]) });
    expect(r.order.map((c) => c.candidate_id)).toEqual(["x", "other", "y"]);
    expect(r.reordered).toBe(0);
  });

  it("a listing page never represents the group", () => {
    const listing = { ...thin(["doc:5"]), listing_like: true, snippet_chars: 5000 };
    const list: C[] = [
      { candidate_id: "listing", title: "index", source_url: "https://l" },
      { candidate_id: "doc", title: "index", source_url: "https://d" },
    ];
    const r = run(list, { listing, doc: thin(["doc:5"]) });
    expect(r.order[0].candidate_id).toBe("doc");
  });
});
