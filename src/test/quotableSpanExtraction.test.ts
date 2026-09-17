import { describe, expect, it } from "vitest";

import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import { cleanQuotableText, snapWindow } from "../../supabase/functions/legal-research-v2/evidence/quotable";
import { matchSpan } from "../../supabase/functions/legal-research-v2/verification/spanMatch";
import { buildResearchStateMessage } from "../../supabase/functions/legal-research-v2/agent/contextWindow";
import { AcquisitionLedger } from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger";
import { StopPolicy } from "../../supabase/functions/legal-research-v2/agent/stopPolicy";
import type { Intake } from "../../supabase/functions/legal-research-v2/types";

const BODY = [
  "חוק יחסי ממון בין בני זוג, התשל\u05f3\u05d3-1973",
  "5. (א) עם\u00a0התרת\u200f הנישואין או עם פקיעת הנישואין עקב מותו של בן זוג זכאי כל אחד מבני הזוג למחצית שוויים של כלל נכסי בני הזוג.",
  "8. ראה בית המשפט נסיבות מיוחדות המצדיקות זאת, רשאי הוא לקבוע שאיזון שווי הנכסים לא יהיה מחצה על מחצה.",
].join("\n");

async function storeWith(text: string) {
  const store = new EvidenceStore();
  const src = await store.append({
    url: "https://example.gov.il/law",
    title: "חוק יחסי ממון",
    origin: "official",
    fetch_status: "ok",
    extracted_text: text,
    is_actual_document: true,
  });
  return { store, src };
}

describe("quotable excerpt preparation", () => {
  it("removes invisible controls and exotic spaces but keeps the words", () => {
    const cleaned = cleanQuotableText("עם\u00a0התרת\u200f  הנישואין");
    expect(cleaned).toBe("עם התרת הנישואין");
  });

  it("snaps a window to whitespace so no word is cut in half", () => {
    const w = snapWindow(BODY, 30, 60);
    expect(w.startsWith(" ")).toBe(false);
    expect(BODY.replace(/\s+/g, " ")).toContain(w.split("\n")[0].slice(0, 20));
  });

  it("a served excerpt still verifies verbatim against the raw stored body", async () => {
    const { store, src } = await storeWith(BODY);
    const served = store.serveQuotes(src.source_id, [BODY.slice(60, 260)], "סעיף 5");
    expect(served.length).toBe(1);
    const quoted = served[0].text.slice(0, 80);
    const r = matchSpan(src.extracted_text, quoted);
    expect(r.matched).toBe(true);
  });
});

describe("served quote memory", () => {
  it("deduplicates identical excerpts and survives serialization", async () => {
    const { store, src } = await storeWith(BODY);
    const a = store.serveQuotes(src.source_id, [BODY.slice(0, 300)]);
    const b = store.serveQuotes(src.source_id, [BODY.slice(0, 300)]);
    expect(b[0].quote_id).toBe(a[0].quote_id);
    const back = EvidenceStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
    expect(back.servedQuotes(src.source_id)[0].text).toBe(a[0].text);
  });

  it("re-surfaces literal excerpts in the rolling research state", async () => {
    const { store, src } = await storeWith(BODY);
    store.serveQuotes(src.source_id, [BODY.slice(60, 300)], "סעיף 5");
    const intake = {
      question: "מהו איזון המשאבים?",
      normalized_question: "מהו איזון המשאבים?",
      docket_obligations: [],
      statute_obligations: [],
      budgets: {
        max_agent_steps: 10,
        max_search_calls: 4,
        max_fetch_calls: 4,
        max_lookup_calls: 2,
      },
    } as unknown as Intake;
    const msg = buildResearchStateMessage({
      intake,
      store,
      ledger: new AcquisitionLedger(),
      policy: new StopPolicy(intake.budgets),
    });
    expect(msg).toContain("קטעים מילוליים שכבר הוגשו לך");
    expect(msg).toContain(store.servedQuotes(src.source_id)[0].quote_id);
  });
});

describe("citation hygiene", () => {
  it("never prints an internal served-excerpt id in a footnote", async () => {
    const { formatCitation } = await import(
      "../../supabase/functions/legal-research-v2/drafting/render"
    );
    const out = formatCitation({
      display_title: "חוק יחסי ממון בין בני זוג, תשל\"ג-1973",
      locator: "S2-q25; סעיפים 4(א)–5",
      url: "https://www.nevo.co.il/law_html/law00/72138.htm",
    } as never);
    expect(out).not.toContain("S2-q25");
    expect(out).toContain("סעיפים");
  });
});
