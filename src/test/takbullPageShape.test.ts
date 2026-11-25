import { describe, expect, it } from "vitest";
import { describeRequest } from "../../supabase/functions/takbull-page-observer/shape";

describe("takbull-page-observer request shape", () => {
  it("reports names, sizes and types but never secret values", async () => {
    const body = JSON.stringify({ ExternalCustomerId: "rlx_secretref", OrderTotalSum: 39, Nested: { a: 1 } });
    const req = new Request("https://x.test/functions/v1/takbull-page-observer?token=SECRETQ", {
      method: "POST",
      headers: { "content-type": "application/json", "x-takbull-signature": "t=1700000000,v1=" + "a".repeat(64), "authorization": "Bearer SECRETAUTH" },
      body,
    });
    const shape = await describeRequest(req);
    const text = JSON.stringify(shape);
    for (const secret of ["rlx_secretref", "SECRETQ", "SECRETAUTH", "a".repeat(64)]) expect(text).not.toContain(secret);
    expect(shape.url).toBe("https://x.test/functions/v1/takbull-page-observer");
    expect(shape.queryKeys).toEqual(["token"]);
    expect(shape.headerNames).toContain("x-takbull-signature");
    expect(shape.signatureLikeHeaders).toContainEqual({ name: "x-takbull-signature", length: 80, matchesTakbullFormat: true });
    expect(shape.body).toMatchObject({ bytes: body.length, json: true, keys: { ExternalCustomerId: "string", OrderTotalSum: "number", Nested: "object" } });
  });
  it("reports a missing signature header", async () => {
    const shape = await describeRequest(new Request("https://x.test/f", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(shape.signatureLikeHeaders).toEqual([]);
    expect(shape.headerNames).not.toContain("x-takbull-signature");
  });
});
