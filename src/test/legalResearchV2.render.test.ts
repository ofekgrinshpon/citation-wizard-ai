import { describe, expect, it } from "vitest";

import {
  formatCitation,
  renderAnswer,
} from "../../supabase/functions/legal-research-v2/drafting/render";
import { displayTitleFor } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import { sanitizeBlocks } from "../../supabase/functions/legal-research-v2/drafting/draft";
import type {
  DraftBlock,
  VerifiedEvidencePack,
} from "../../supabase/functions/legal-research-v2/types";

const pack: VerifiedEvidencePack = {
  claims: [
    {
      claim_id: "C1",
      proposition: "טענה ראשונה",
      importance: "core",
      support_status: "supported",
      sources: [
        {
          source_id: "S1",
          display_title: 'בג"ץ 1234/20 פלוני נ\' היועמ"ש',
          url: "https://supreme.court.gov.il/doc/1",
          verified_span: "ציטוט מאומת ארוך דיו",
          locator: "פסקה 12",
          support: "supports",
        },
      ],
    },
    {
      claim_id: "C2",
      proposition: "טענה שנייה",
      importance: "supporting",
      support_status: "partially_supported",
      sources: [
        {
          source_id: "S2",
          display_title: "חוק יחסי ממון בין בני זוג",
          verified_span: "ציטוט שני מאומת",
          support: "supports_partially",
        },
      ],
    },
  ],
  unsupported_claims: [],
};

describe("deterministic citation renderer", () => {
  it("numbers every citation occurrence chronologically with superscript markers", () => {
    const blocks: DraftBlock[] = [
      { type: "heading", text: "מסגרת נורמטיבית", source_ids: [] },
      { type: "paragraph", text: "פסקה ראשונה", source_ids: ["S1"] },
      { type: "paragraph", text: "פסקה שנייה", source_ids: ["S2", "S1"] },
    ];
    const out = renderAnswer(blocks, pack);
    expect(out.footnotes.map((f) => f.index)).toEqual([1, 2, 3]);
    expect(out.footnotes.map((f) => f.source_id)).toEqual(["S1", "S2", "S1"]);
    expect(out.cited_source_ids).toEqual(["S1", "S2"]);
    expect(out.answer_markdown).toContain("פסקה ראשונה.¹");
    expect(out.answer_markdown).toContain("פסקה שנייה.²³");
    expect(out.answer_markdown).not.toContain("[^");
    expect(out.invariant_errors).toEqual([]);
  });

  it("never cites a source that is not in the verified pack", () => {
    const out = renderAnswer(
      [{ type: "paragraph", text: "פסקה", source_ids: ["S9"] }],
      pack,
    );
    expect(out.footnotes).toHaveLength(0);
    expect(out.invariant_errors[0]).toContain("S9");
  });

  it("formats a citation with locator and url, without database suffixes", () => {
    expect(formatCitation({ display_title: "פסק דין כלשהו – נבו", locator: "עמ' 5" }))
      .toBe("פסק דין כלשהו, עמ' 5");
  });
});

describe("drafter output sanitation", () => {
  it("strips citation markup and drops unverified source ids", () => {
    const { blocks, dropped_source_ids } = sanitizeBlocks(
      [
        {
          type: "paragraph",
          text: "טקסט עם הפניה[^3] וקישור https://example.com/x",
          source_ids: ["S1", "S404"],
        },
        { type: "paragraph", text: "   ", source_ids: [] },
      ],
      pack,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).not.toContain("[^3]");
    expect(blocks[0].text).not.toContain("http");
    expect(blocks[0].source_ids).toEqual(["S1"]);
    expect(dropped_source_ids).toEqual(["S404"]);
  });
});

describe("title hygiene for fetched sources", () => {
  it("never uses a URL as a citation title and never repeats the URL", () => {
    const out = formatCitation({
      display_title: "https://example.gov.il/doc.pdf",
      url: "https://example.gov.il/doc.pdf",
      locator: 'בג"ץ 8928/06',
    });
    expect(out).toBe('בג"ץ 8928/06 https://example.gov.il/doc.pdf');
  });

  it("recovers a Hebrew title from the fetched body when discovery gave a URL", () => {
    const title = displayTitleFor(
      "https://example.gov.il/doc.pdf",
      'בבית המשפט העליון בשבתו כבית משפט גבוה לצדק\nבג"ץ 8928/06 פלונית נגד בית הדין הרבני הגדול\nפסק דין',
      { dockets: ["8928/06"], statutes: [], sections: [] },
    );
    expect(title).toContain("בית המשפט העליון");
    expect(title).not.toContain("http");
  });
});

describe("locator deduplication", () => {
  it("drops a docket from the locator when the title already carries it", () => {
    const out = formatCitation({
      display_title: 'בג"צ 1000/92 – חוה בבלי נ\' בית הדין הרבני הגדול',
      locator: 'בג"ץ 1000/92, פסק דינו של המשנה לנשיא ברק',
      url: "https://example.org/x",
    });
    expect(out).toBe(
      'בג"צ 1000/92 – חוה בבלי נ\' בית הדין הרבני הגדול, פסק דינו של המשנה לנשיא ברק https://example.org/x',
    );
  });
});
