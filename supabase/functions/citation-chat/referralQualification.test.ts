import { cleanSingleCitation, completeLegacyReferralCitation, deliverVerifiedReferralCitation, parseReferralVerifiedSourceBody, usableVerifiedReferralCitation } from "./referralQualification.ts";
import assert from "node:assert/strict";

Deno.test("only full recognized citation examples qualify for the generic formatter", () => {
  const complete = [
    "ע״א 6821/93 **בנק המזרחי המאוחד בע״מ נ׳ מגדל כפר שיתופי**, פ״ד מט(4) 221 (1995).",
    "ע״א 6821/93 בנק המזרחי נ׳ מגדל כפר שיתופי (נבו 9.11.1995).",
    "חוק החוזים (חלק כללי), התשל״ג–1973.",
    "Brown v. Board of Education, 347 U.S. 483 (1954).",
  ];
  for (const citation of complete) assert.equal(completeLegacyReferralCitation(citation), true, citation);
  const incomplete = [
    "", "3.", "אולי זה ע״א 6821/93?", "ע״א 6821/93 בנק המזרחי המאוחד נ׳ מגדל כפר שיתופי.",
    "ע״א 6821/93 בנק המזרחי המאוחד נ׳ מגדל, פ״ד מט(4) 221 [חסר: שנה].",
    "⚠️ חסרים פרטים", "לא נשלחה קריאת מודל נוספת.", "חוק החוזים.",
    "1. Brown v. Board of Education, 347 U.S. 483 (1954).",
    "Brown v. Board of Education, 347 U.S. 483 (1954).\nאיזה פסק דין?",
    "Brown v. Board of Education, 347 U.S. 483.",
    "מצאתי: ע״א 6821/93 בנק המזרחי המאוחד נ׳ מגדל, פ״ד מט(4) 221 (1995).",
  ];
  for (const citation of incomplete) assert.equal(completeLegacyReferralCitation(citation), false, citation);
});

Deno.test("curated verified-store output cannot be empty, unresolved, or a list", () => {
  assert(usableVerifiedReferralCitation("John Finnis, Natural Law and Natural Rights (2011)."));
  assert(!usableVerifiedReferralCitation("נמצאו מספר תוצאות."));
  assert(!usableVerifiedReferralCitation("⚠️ תוצאה חלקית, 2011."));
  assert(!usableVerifiedReferralCitation("1. Roe v. Wade, 410 U.S 113 (1973)."));
  assert(!usableVerifiedReferralCitation("Roe v. Wade, 410 U.S 113 (1973).\n2. Another case."));
  assert.equal(cleanSingleCitation("לא נמצאו תוצאות 2026."), null);
});

Deno.test("raw-free canonical route accepts only ids and normal routing metadata", () => {
  const sourceId = "14b32bcc-429f-491b-850e-f354fe7cb66d";
  const requestId = "1414925b-203d-4c7f-9824-12cfe9d371de";
  const body = { citationRequestVersion: 3, requestId, referralVerifiedSource: { sourceId } };
  assert.deepEqual(parseReferralVerifiedSourceBody(body), { sourceId, requestId });
  assert.equal(parseReferralVerifiedSourceBody({ ...body, requestId: "not-a-uuid" }), null);
  for (const key of ["rawInput", "fingerprint", "userId", "formattedOutput", "messages", "referralBonusGranted"]) {
    assert.equal(parseReferralVerifiedSourceBody({ ...body, [key]: "untrusted" }), null, key);
  }
  assert.equal(parseReferralVerifiedSourceBody({ ...body, referralVerifiedSource: { sourceId, complete: true } }), null);
});

Deno.test("canonical route debits once, then confirms and serves only server result", async () => {
  const content = "חוק החוזים (חלק כללי), התשל״ג–1973.";
  const order: string[] = [];
  const result = await deliverVerifiedReferralCitation({
    fetchSource: async () => { order.push("verify"); return { data: { full_citation: content, source_type: "legislation" }, error: null }; },
    debit: async () => { order.push("debit"); return { data: { ok: true }, error: null }; },
    confirm: async () => { order.push("confirm"); return true; },
  });
  assert.deepEqual(order, ["verify", "debit", "confirm"]);
  assert.deepEqual(result, { ok: true, content, sourceType: "legislation", referralBonusGranted: true });
});

Deno.test("unverified, invalid, exhausted, or uncertain debits cannot confirm a reward", async () => {
  const content = "חוק החוזים (חלק כללי), התשל״ג–1973.";
  for (const state of ["missing", "ambiguous", "read-failure", "quota", "network"]) {
    let debits = 0, confirmations = 0;
    const result = await deliverVerifiedReferralCitation({
      fetchSource: async () => ({ data: state === "missing" ? null : {
        full_citation: state === "ambiguous" ? "נמצאו כמה מקורות, נא לבחור ביניהם." : content, source_type: null,
      }, error: state === "read-failure" ? new Error("read") : null }),
      debit: async () => { debits++; return { data: { ok: false, error: "TRIAL_EXHAUSTED" }, error: state === "network" ? new Error("lost") : null }; },
      confirm: async () => { confirmations++; return true; },
    });
    assert.equal(debits, ["quota", "network"].includes(state) ? 1 : 0, state);
    assert.equal(confirmations, 0, state);
    assert.equal(result.ok, false, state);
    if (!result.ok) assert.equal(result.status, state === "quota" ? 402 : ["network", "read-failure"].includes(state) ? 503 : 404, state);
  }
});

Deno.test("unconfirmed qualification does not hide the citation", async () => {
  const result = await deliverVerifiedReferralCitation({
    fetchSource: async () => ({ data: { full_citation: "Brown v. Board of Education, 347 U.S. 483 (1954).", source_type: null }, error: null }),
    debit: async () => ({ data: { ok: true }, error: null }),
    confirm: async () => { throw new Error("timeout"); },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.referralBonusGranted, false);
});
