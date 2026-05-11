// Academic chapter critic.
//
// Audits a finished structured-drafter chapter against its claim map and
// source pack, flagging missing claims, ungrounded paragraphs, weak narrative
// citations, and low footnote density. Returns a structured verdict +
// issue list; the caller decides whether to trigger a single revision pass.
//
// Provider: callPlannerJSON (defaults to OpenAI when OPENAI_API_KEY is
// present, otherwise Gemini via Lovable AI Gateway). Stage name: "critic".

import { callPlannerJSON, type StageRun } from "./aiProvider.ts";
import type { LegalClaimMap, LegalSourcePack } from "./contracts.ts";
import type { AcademicProfile } from "./academicProfiles.ts";

export type CriticIssueKind =
  | "missing_claim"
  | "ungrounded_paragraph"
  | "weak_narrative_citation"
  | "footnote_density_low"
  | "off_topic_paragraph"
  | "anchor_misuse";

export interface CriticIssue {
  kind: CriticIssueKind;
  severity: "low" | "medium" | "high";
  evidence: string;
  fix_hint: string;
  claim_id?: string;
  source_ids?: string[];
}

export interface CriticResult {
  verdict: "pass" | "revise";
  issues: CriticIssue[];
  coverage: {
    claims_total: number;
    claims_supported: number;
    cards_total: number;
    cards_cited: number;
  };
}

const CRITIC_TOOL = {
  name: "report_critique",
  description:
    "Audit the chapter draft against the claim map and source pack. Return a structured verdict.",
  parameters: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["pass", "revise"] },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: [
                "missing_claim",
                "ungrounded_paragraph",
                "weak_narrative_citation",
                "footnote_density_low",
                "off_topic_paragraph",
                "anchor_misuse",
              ],
            },
            severity: { type: "string", enum: ["low", "medium", "high"] },
            evidence: { type: "string", maxLength: 240 },
            fix_hint: { type: "string", maxLength: 240 },
            claim_id: { type: "string" },
            source_ids: { type: "array", items: { type: "string" } },
          },
          required: ["kind", "severity", "evidence", "fix_hint"],
          additionalProperties: false,
        },
      },
      coverage: {
        type: "object",
        properties: {
          claims_total: { type: "integer", minimum: 0 },
          claims_supported: { type: "integer", minimum: 0 },
          cards_total: { type: "integer", minimum: 0 },
          cards_cited: { type: "integer", minimum: 0 },
        },
        required: ["claims_total", "claims_supported", "cards_total", "cards_cited"],
        additionalProperties: false,
      },
    },
    required: ["verdict", "issues", "coverage"],
    additionalProperties: false,
  },
} as const;

function buildSystemPrompt(): string {
  return [
    "אתה עורך אקדמי משפטי. תפקידך לבדוק טיוטת פרק כתיבה אקדמית מול ה-claim map וה-source pack שסיפקו לכותב.",
    "",
    "בדוק ארבעה דברים בלבד:",
    "1) missing_claim — טענות מהמפה (statementMode != \"omit\") שלא הופיעו כלל בטקסט.",
    "2) ungrounded_paragraph — פסקה משפטית מהותית ללא מראה-מקום [N] קרוב ובלי תופעה נרטיבית (בעניין X / פרופ' Y / ועדת Z).",
    "3) weak_narrative_citation — סימון [N] קיים אך אין משפט נרטיבי 120 תווים לפניו.",
    "4) footnote_density_low — צפיפות מראי-מקום נמוכה משמעותית ביחס ל-cards_total.",
    "כל ממצא חייב evidence (ציטוט מילולי קצר מהטיוטה) ו-fix_hint פעולתי.",
    "",
    "כללים נוקשים:",
    "• אל תמציא מקורות. ציין רק source_ids שמופיעים בפועל ב-source pack.",
    "• אם הטיוטה תקינה במהותה — החזר verdict=\"pass\" עם issues=[].",
    "• coverage חייב להיות מספרי אמיתי, לא הערכה.",
    "• אל תכתוב טקסט חופשי — רק קריאת הכלי report_critique.",
  ].join("\n");
}

function summarizeClaimMapForCritic(cm: LegalClaimMap): string {
  const allowed = cm.claims.filter((c) => c.statementMode !== "omit");
  return JSON.stringify(
    allowed.map((c) => ({
      claim_id: c.claimId,
      claim_text: c.claimText.slice(0, 240),
      source_ids: c.sourceIds,
      authority: c.authorityLevel,
    })),
    null,
    0,
  );
}

function summarizeSourcePackForCritic(sp: LegalSourcePack): string {
  const all = [...sp.coreSources, ...sp.supportingSources, ...sp.secondarySources];
  return JSON.stringify(
    all.map((s) => ({
      source_id: s.sourceId,
      title: s.title.slice(0, 160),
      type: s.sourceType,
      authority: s.authorityClass,
      url: s.url,
      usable_for_analysis: s.usableForAnalysis,
      usable_for_citation: s.usableForCitation,
    })),
    null,
    0,
  );
}

export interface RunChapterCriticArgs {
  draft: string;
  claimMap: LegalClaimMap;
  sourcePack: LegalSourcePack;
  profile: AcademicProfile;
  timeoutMs?: number;
}

export interface RunChapterCriticOutput {
  result: CriticResult | null;
  run: StageRun;
}

export async function runChapterCritic(
  args: RunChapterCriticArgs,
): Promise<RunChapterCriticOutput> {
  const { draft, claimMap, sourcePack } = args;
  const timeoutMs = args.timeoutMs ?? 25_000;

  // Split body / footnotes so the critic can audit prose vs apparatus.
  const fnSplitIdx = draft.search(/---\s*הערות שוליים\s*---|\*\*\s*הערות שוליים\s*\*\*/);
  const body = fnSplitIdx === -1 ? draft : draft.slice(0, fnSplitIdx);
  const footnotesBlock = fnSplitIdx === -1 ? "" : draft.slice(fnSplitIdx);

  const userPrompt = [
    `=== טיוטה — גוף הפרק ===\n${body.trim()}`,
    footnotesBlock ? `\n=== טיוטה — הערות שוליים ===\n${footnotesBlock.trim()}` : "",
    `\n=== Claim Map (טענות שהותרו) ===\n${summarizeClaimMapForCritic(claimMap)}`,
    `\n=== Source Pack ===\n${summarizeSourcePackForCritic(sourcePack)}`,
  ].join("\n");

  const res = await callPlannerJSON<CriticResult>(
    buildSystemPrompt(),
    userPrompt,
    CRITIC_TOOL,
    { stage: "critic", timeoutMs, reasoningEffort: "low" },
  );

  // Defensive shape guard — coerce coverage/issues to safe defaults when the
  // model omits a field. We treat any malformed response as "no revision".
  if (res.data) {
    res.data.issues = Array.isArray(res.data.issues) ? res.data.issues : [];
    res.data.coverage = res.data.coverage ?? {
      claims_total: 0,
      claims_supported: 0,
      cards_total: 0,
      cards_cited: 0,
    };
  }
  return { result: res.data, run: res.run };
}

/**
 * Decide whether the critic's verdict warrants a revision pass.
 * Thresholds intentionally conservative — we'd rather skip a borderline
 * revision than burn latency on every chapter.
 */
export function shouldRevise(
  result: CriticResult | null,
  profile: AcademicProfile,
): boolean {
  if (!result || result.verdict !== "revise") return false;
  const high = result.issues.filter((i) => i.severity === "high").length;
  const medium = result.issues.filter((i) => i.severity === "medium").length;
  const total = result.coverage.claims_total || 0;
  const supported = result.coverage.claims_supported || 0;
  const coverageRatio = total > 0 ? supported / total : 1;
  const minCoverage = profile.criticMinCoverage ?? 0.7;
  return high >= 1 || medium >= 2 || coverageRatio < minCoverage;
}
