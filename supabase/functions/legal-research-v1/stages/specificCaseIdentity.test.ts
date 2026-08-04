import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractRequestedCaseTitle,
  isGenericTitle,
  recoverJudgmentTitle,
  runSpecificCaseIdentity,
  strongTitleMatch,
} from "./specificCaseIdentity.ts";
import { detectDockets } from "./docketDetection.ts";
import type { Candidate } from "../lib/types.ts";

const Q = `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?`;

function cand(over: Partial<Candidate>): Candidate {
  return {
    candidate_id: "c1",
    claim_id: "C1",
    role: "binding_case_law",
    origin: "web",
    retrieval_method: "text",
    title: "מסמך מאתר gov.il",
    source_type: "caselaw",
    source_url: "https://supreme.court.gov.il/Download.aspx?id=1",
    snippet: "",
    query_he: "q",
    score: 1,
    expected_source_type: "case",
    metadata: {},
    ...over,
  } as Candidate;
}

Deno.test("generic titles detected", () => {
  assertEquals(isGenericTitle("מסמך מאתר gov.il"), true);
  assertEquals(isGenericTitle("supreme_court_il document"), true);
  assertEquals(isGenericTitle(""), true);
  assertEquals(isGenericTitle(`ע"א 6821/93 בנק המזרחי נ' מגדל`), false);
});

Deno.test("requested case title extraction + strong match", () => {
  const t = extractRequestedCaseTitle(Q);
  assertEquals(t, `בנק המזרחי המאוחד נ' מגדל כפר שיתופי`);
  assertEquals(strongTitleMatch(t!, "פסק דין בעניין בנק המזרחי המאוחד ומגדל כפר שיתופי"), true);
  assertEquals(strongTitleMatch(t!, "פסק דין בעניין קעדאן"), false);
});

Deno.test("title recovery from body heading", () => {
  const body = `ע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי\nבבית המשפט העליון\n${"טקסט ".repeat(200)}`;
  const c = cand({ metadata: { extended_text: body } });
  const rec = recoverJudgmentTitle(c, detectDockets(Q), extractRequestedCaseTitle(Q));
  assertEquals(rec?.via, "body_heading");
  assertEquals(rec!.title.includes("6821/93"), true);
});

Deno.test("identity passes on judgment body carrying the docket", () => {
  const body = `ע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי\n${"פסק דין ".repeat(200)}`;
  const c = cand({
    metadata: {
      extended_text: body,
      source_integrity: { citable_as: "judgment", text_usability: "full_text" },
    },
  });
  const r = runSpecificCaseIdentity({ research_mode: "specific_case", question: Q, candidates: [c] });
  assertEquals(r.specific_case_identity_passed, true);
  assertEquals(r.title_recovery_success, true);
  assertEquals(c.title.includes("6821/93"), true);
});

Deno.test("scholarship alone cannot satisfy specific-case identity", () => {
  const c = cand({
    title: "מאמר על הלכת בנק המזרחי",
    source_type: "article",
    metadata: {
      extended_text: `ע"א 6821/93 ${"דיון אקדמי ".repeat(200)}`,
      source_integrity: { citable_as: "scholarship", text_usability: "full_text" },
    },
  });
  const r = runSpecificCaseIdentity({ research_mode: "specific_case", question: Q, candidates: [c] });
  assertEquals(r.specific_case_identity_passed, false);
  assertEquals(r.specific_case_identity_failure_reason, "only_scholarship_or_commentary");
});

Deno.test("generic gov document without identity in body fails", () => {
  const c = cand({
    metadata: {
      extended_text: "החלטה בעניין אחר לגמרי ".repeat(60),
      source_integrity: { citable_as: "judgment", text_usability: "full_text" },
    },
  });
  const r = runSpecificCaseIdentity({ research_mode: "specific_case", question: Q, candidates: [c] });
  assertEquals(r.specific_case_identity_passed, false);
  assertEquals(r.specific_case_identity_failure_reason, "judgment_body_missing_identity");
});
