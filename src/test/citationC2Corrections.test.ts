import { describe, expect, it } from "vitest";
import { renderBook } from "@/data/bluebook/render";
import { CHAT_HOST, RUNNER_HOST, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse } from "@/lib/citationPlanner";
import { citationManualChoice } from "@/lib/pastedCitationAdapter";
import { acceptCitationCompletion } from "@/lib/citationCompletion";
import { C2_CORRECTION_MODES, c2CorrectionPayload, c2CorrectionFixture } from "./fixtures/c2BookPayload";

function plan(mode: typeof C2_CORRECTION_MODES[number], caps = CHAT_HOST) {
  const f = c2CorrectionFixture(mode);
  const input = { evidence: planCitationEvidence(f.rawInput, citationManualChoice(f.type)), sourceType: f.type, input: f.rawInput, isPinpoint: false, manual: true };
  const local = planLocalCitation(input, caps);
  return "resolution" in local ? local : planTypedRequest({ ...input, statutePrep: local.statutePrep, canonicalRaw: f.rawInput }, caps);
}
describe("narrow C2 corrections — real extraction and shared resolution", () => {
  it.each(C2_CORRECTION_MODES)("%s", async mode => {
    const { response, calls, rawInput } = await c2CorrectionPayload(mode);
    for (const caps of [CHAT_HOST, RUNNER_HOST]) {
      const p = plan(mode, caps);
      if (mode === "firstPage-only") {
        expect("resolution" in p).toBe(true);
        if ("resolution" in p) expect(p.resolution.reply).toContain("firstPage");
        continue;
      }
      expect("foreignLookup" in p && p.foreignLookup?.kind).toBe(mode === "edition-book" ? "book" : "book_chapter");
      if (!("foreignLookup" in p)) continue;
      const result = resolveCitationResponse(p, { foreignLookup: response, content: "UNSAFE" }, caps);
      expect(result.kind).toBe("terminal");
      if (result.kind !== "terminal") continue;
      const c = result.resolution.completion;
      if (mode === "wrong-chapter" || mode === "absent-chapter") {
        expect(response.identity.matched).toBe(false);
        expect(response.fields).toEqual({});
        expect(c?.identityConfirmed).toBe(false); expect(c?.fields).toEqual({});
        expect(result.resolution.reply).toContain(rawInput); expect(result.resolution.reply).toContain("פרק");
      } else {
        expect(response.fields.edition).toBe("2nd ed.");
        expect(c?.fields.edition).toBe("2nd ed.");
        expect(c?.provenance.edition).toMatchObject({ value: "2nd ed." });
        expect(result.resolution.citation).toContain("(2nd ed. 2020)");
        expect(result.resolution.citation).not.toContain("ed. ed.");
        if (mode === "partial-chapter") {
          expect(c?.missing).toContain("firstPage"); expect(c?.fields.firstPage).toBeUndefined();
          expect(c?.completeness).toBe("partial");
        }
      }
      expect(result.resolution.pastedCitation?.rawInput).toBe(rawInput);
    }
    expect(calls).toEqual(["https://api.perplexity.ai/search"]);
  });
  it("old collection-only matched envelope cannot confirm a chapter", async () => {
    const { response, rawInput } = await c2CorrectionPayload("edition-chapter");
    response.identity.anchors = ["title:Synthetic Collection", "author:Jane Doe"];
    const result = acceptCitationCompletion({ kind: "book_chapter", jurisdiction: "OTHER", rawInput, parsedFields: { chapterTitle: "Quiet Rules", bookTitle: "Synthetic Collection", authors: "Jane Doe" } }, rawInput, response);
    expect(result.identityConfirmed).toBe(false); expect(result.fields).toEqual({});
  });
  it.each([["2nd", "2nd ed."], ["2d", "2d ed."], ["2nd ed.", "2nd ed."], ["2nd ed", "2nd ed."], ["Special revisited edition", "Special revisited edition"]])("recognized/unknown edition %s renders without changing the field", (edition, expected) => {
    const fields = { authors: "Jane Doe", bookTitle: "Synthetic Collection", edition, year: "2020" };
    expect(renderBook(fields).citation).toContain(`(${expected} 2020)`);
    expect(fields.edition).toBe(edition);
  });
});