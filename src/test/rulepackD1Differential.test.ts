/**
 * D1 differential gate: frozen pre-D1 (baseline b36df130) planner/server outputs
 * for existing US/UK/literature/Israeli inputs. Capture with D1_CAPTURE=1 only
 * on the baseline; never regenerate to hide a regression.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CHAT_HOST, RUNNER_HOST, planCitationEvidence, planLocalCitation, planTypedRequest } from "@/lib/citationPlanner";
import { citationManualChoice } from "@/lib/pastedCitationAdapter";
import { guardPastedCitationRequest } from "../../supabase/functions/_shared/pastedCitation";
import type { SourceType } from "@/data/abbreviations";

const FIXTURE = "src/test/fixtures/rulepackD1Baseline.json";
const CASES: Array<{ raw: string; type?: SourceType; jid?: string }> = [
  { raw: "Brown v. Board of Education, 347 U.S. 483 (1954)" },
  { raw: "Brown v. Board of Education", type: "foreign_case_us" },
  { raw: "Brown v. Board of Education" },
  { raw: "R (Miller) v. Secretary of State [2017] UKSC 5" },
  { raw: "Donoghue v. Stevenson [1932] AC 562 (HL)", type: "foreign_case_other", jid: "t2:united-kingdom" },
  { raw: "17 U.S.C. §512 (2018)", type: "foreign_statute_us" },
  { raw: "Human Rights Act 1998, c. 42", type: "foreign_statute_uk" },
  { raw: "Copyright Act", type: "foreign_statute_us" },
  { raw: "Author: Jane Doe; Book: Synthetic Collection; Original year: 1901", type: "foreign_book" },
  { raw: "Jane Doe, Hidden Costs, 12 Yale L.J. 34 (2020)", type: "foreign_journal_article" },
  { raw: "BVerfG, Urteil vom 15. Januar 1958, 1 BvR 400/51, BVerfGE 7, 198" },
  { raw: "Smith v. Jones C## Guide: x^^2 & A**B", type: "foreign_case_other" },
  { raw: 'ע"א 400/51 כהן נ׳ לוי' },
  { raw: "🙂 Brown v. Board of Education, 347 U.S. 483 (1954) — הערה" },
  { raw: "Smith v. Jones", type: "foreign_case_other", jid: "t2:brazil" },
];

function snapshot() {
  return CASES.map(({ raw, type, jid }) => {
    const manual = jid ? citationManualChoice(type, jid) : type ? citationManualChoice(type) : null;
    const ev = planCitationEvidence(raw, manual);
    const hosts = [CHAT_HOST, RUNNER_HOST].map(caps => {
      if (ev.preserve) return { preserve: ev.preserve };
      const input = { evidence: ev, sourceType: type ?? ev.pasted.detection?.sourceType ?? null, input: raw, isPinpoint: false, manual: !!type };
      const local = planLocalCitation(input, caps);
      if ("resolution" in local) return { local };
      const typed = planTypedRequest({ ...input, statutePrep: local.statutePrep, canonicalRaw: raw }, caps);
      return { typed: { kind: typed.kind, foreignLookup: typed.foreignLookup, extraBody: typed.extraBody } };
    });
    const guard = guardPastedCitationRequest({ messages: [{ role: "user", content: raw }], rawInput: raw, pastedCitation: ev.pasted.contract });
    const { manualChoice: _m, ...contract } = ev.pasted.contract;
    return { raw, type, jid, contract, hosts, server: { route: guard.route, conflicts: guard.conflicts, unsupported: guard.unsupported, jurisdiction: guard.jurisdiction } };
  });
}

describe("D1 differential: existing US/UK/literature behavior frozen", () => {
  it("matches the pre-D1 baseline exactly", () => {
    const now = JSON.parse(JSON.stringify(snapshot()));
    if (process.env.D1_CAPTURE === "1" && !existsSync(FIXTURE)) writeFileSync(FIXTURE, JSON.stringify(now, null, 1));
    const frozen = JSON.parse(readFileSync(FIXTURE, "utf8"));
    expect(now).toEqual(frozen);
  });
});
