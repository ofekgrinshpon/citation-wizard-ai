import { describe, expect, it } from "vitest";
import { CHAT_HOST, resolveCitationResponse } from "@/lib/citationPlanner";
import { suppliedLookupFieldsMatch } from "../../supabase/functions/_shared/pastedCitation";
import { C2_WIRE, c2WirePayload } from "./fixtures/c2WirePayload";
describe("C2 complete local fields versus bound lookup projection", () => {
  it.each(C2_WIRE)("$id retains exact source semantics and valid wire", async f => {
    const { plan, response, calls } = await c2WirePayload(f);
    const req = plan.foreignLookup;
    expect(req).not.toBeNull();
    if (!req) throw new Error("Missing typed request");
    expect(suppliedLookupFieldsMatch(f.raw, String(req.kind), req.parsedFields)).toBe(true);
    expect(req.parsedFields).not.toHaveProperty("originalYear");
    expect(req.parsedFields).not.toHaveProperty("publisher");
    expect(req.parsedFields).not.toHaveProperty("publisherStatus");
    if (f.id === "C") expect(req.parsedFields).toHaveProperty("pinpoint", "214-216");
    if (f.id === "D") expect(req.parsedFields).not.toHaveProperty("pinpoint");
    const resolved = resolveCitationResponse(plan, { foreignLookup: response }, CHAT_HOST);
    if (resolved.kind !== "terminal") throw new Error("Expected safe terminal completion");
    expect(resolved.resolution.citation).toContain(f.output);
    expect(resolved.resolution.completion?.fields.year).toBe("2020");
    expect(resolved.resolution.completion?.provenance.edition).toMatchObject({ value: "2nd ed." });
    for (const [key, value] of Object.entries(f.local)) {
      const field = resolved.resolution.completion?.suppliedFields?.[key];
      expect(field?.value).toBe(value);
      for (const span of field?.spans ?? []) expect(f.raw.slice(span.start, span.end)).toBe(value);
      expect(field?.spans).toHaveLength(1);
    }
    expect(calls).toEqual(["https://api.perplexity.ai/search"]);
    expect(resolved.resolution.pastedCitation?.rawInput).toBe(f.raw);
  });
  it("retains original-input span offsets with leading whitespace", async () => {
    const f = { ...C2_WIRE[2], raw: "  " + C2_WIRE[2].raw + "  " };
    const { plan } = await c2WirePayload(f);
    const field = plan.localSourceFields?.pinpoint;
    expect(field?.value).toBe("214-216");
    expect(field?.spans).toHaveLength(1);
    for (const span of field?.spans ?? []) expect(f.raw.slice(span.start, span.end)).toBe("214-216");
  });
});