// Phase 7 / Stage 2 — Candidate Claims (hypotheses, never citations).
//
// Takes the question + decomposition + IssueMap and emits a small list of
// concrete claim hypotheses that downstream verification (Stage 3) will
// either accept (direct/partial support) or reject (tangential/unrelated).
//
// IMPORTANT: a candidate claim is NOT a fact. The drafter may not assert it
// unless Stage 3 promotes it to `supported` or `partially_supported`.

import { callPlannerJSON, type PlannerToolDef, type StageRun } from "./aiProvider.ts";
import type {
  CandidateClaim,
  IssueMap,
  LegalResearchDecomposition,
} from "./contracts.ts";

const TOOL: PlannerToolDef = {
  name: "submit_candidate_claims",
  description:
    "Emit a small list of candidate legal claim hypotheses derived from the question, decomposition, and issue map. These are hypotheses for verification — never assertions.",
  parameters: {
    type: "object",
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Stable id like C1, C2, ..." },
            statement: { type: "string", description: "Single Hebrew sentence stating the claim hypothesis." },
            kind: {
              type: "string",
              enum: ["doctrinal", "empirical", "normative", "procedural"],
            },
            required_evidence: {
              type: "array",
              items: { type: "string", enum: ["statute", "case", "academic", "committee", "news"] },
            },
            generated_search_queries: {
              type: "array",
              items: { type: "string", description: "Hebrew search query that would surface direct support for the claim." },
            },
          },
          required: ["id", "statement", "kind", "required_evidence", "generated_search_queries"],
          additionalProperties: false,
        },
      },
    },
    required: ["claims"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `אתה שכבת CANDIDATE CLAIMS עבור צינור מחקר משפטי ישראלי.

קלט: שאלת המחקר, פירוק לסוגיות, ומפת סוגיה (Issue Map) רחבה (ללא URLs).
פלט: רשימת *השערות* קצרה, כל אחת ממוקדת באבן בניין אחת בתשובה.

כללים קריטיים:
1. **השערות בלבד.** כל טענה היא השערה שנבדקת בשלב 3 ע"י מקורות מאומתים. אם הבדיקה תכשל, הטענה תיפסל.
2. כל טענה היא משפט אחד בלבד, חד וניתן לאימות (לא אוסף טענות).
3. אם הטענה דורשת מקור ספציפי (פסק דין מכונן / חוק / מאמר), ציין זאת ב-required_evidence.
4. generated_search_queries: 2–4 שאילתות עבריות *ספציפיות* שיחזירו תמיכה ישירה (שמות צדדים, מספרי תיקים, סעיפי חוק, מונחים דוקטרינריים).
5. אל תכלול שאילתות כלליות מדי כמו "אקטיביזם שיפוטי" — חייב להיות צירוף עם הסוגיה הספציפית (למשל "אקטיביזם שיפוטי עוברים מוקפאים נחמני").
6. ההשערות שלך אינן ראיות ואינן מקורות. אסור להמציא ציטוטים.

החזר JSON בלבד דרך הכלי submit_candidate_claims.`;

function buildUserPrompt(
  question: string,
  decomposition: LegalResearchDecomposition | null,
  issueMap: IssueMap | null,
  cap: number,
): string {
  const lines: string[] = [];
  lines.push(`שאלת מחקר:\n${question}`);
  if (decomposition) {
    lines.push("");
    lines.push(`סוגיה מרכזית: ${decomposition.mainIssue}`);
    if (decomposition.subIssues?.length) {
      lines.push(`תתי-סוגיות:\n- ${decomposition.subIssues.join("\n- ")}`);
    }
    lines.push(`סוג שאלה: ${decomposition.questionType}`);
  }
  if (issueMap) {
    lines.push("");
    lines.push(`מסגור הסוגיה: ${issueMap.framing}`);
    if (issueMap.doctrines.length) {
      lines.push(`דוקטרינות: ${issueMap.doctrines.map((d) => d.name).join(" · ")}`);
    }
    if (issueMap.leading_cases.length) {
      lines.push(`פסקי דין מובילים (לבדיקה): ${issueMap.leading_cases.map((c) => c.name).join(" · ")}`);
    }
    if (issueMap.statutes.length) {
      lines.push(`חקיקה רלוונטית: ${issueMap.statutes.map((s) => s.name).join(" · ")}`);
    }
    if (issueMap.competing_positions.length) {
      lines.push(`עמדות מתחרות: ${issueMap.competing_positions.map((p) => p.stance).join(" · ")}`);
    }
  }
  lines.push("");
  lines.push(`הפק עד ${cap} השערות. החזר JSON דרך הכלי.`);
  return lines.join("\n");
}

export interface CandidateClaimsResult {
  claims: CandidateClaim[];
  run: StageRun;
}

export async function buildCandidateClaims(args: {
  question: string;
  decomposition: LegalResearchDecomposition | null;
  issueMap: IssueMap | null;
  cap: number;
}): Promise<CandidateClaimsResult> {
  const { question, decomposition, issueMap, cap } = args;

  const { data, run } = await callPlannerJSON<{ claims: Array<Omit<CandidateClaim, "source_hint">> }>(
    SYSTEM_PROMPT,
    buildUserPrompt(question, decomposition, issueMap, cap),
    TOOL,
    {
      stage: "candidate_claims",
      timeoutMs: 25000,
      reasoningEffort: "minimal",
    },
  );

  if (!data || !Array.isArray(data.claims)) {
    return { claims: [], run };
  }

  const seen = new Set<string>();
  const out: CandidateClaim[] = [];
  for (const c of data.claims) {
    if (!c || typeof c.id !== "string" || typeof c.statement !== "string") continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const kind = ["doctrinal", "empirical", "normative", "procedural"].includes(c.kind)
      ? (c.kind as CandidateClaim["kind"])
      : "doctrinal";
    out.push({
      id: c.id.slice(0, 12),
      statement: c.statement.trim().slice(0, 360),
      kind,
      required_evidence: Array.isArray(c.required_evidence)
        ? (c.required_evidence
            .filter((r) => ["statute", "case", "academic", "committee", "news"].includes(r as string))
            .slice(0, 4) as CandidateClaim["required_evidence"])
        : [],
      generated_search_queries: Array.isArray(c.generated_search_queries)
        ? c.generated_search_queries
            .filter((q): q is string => typeof q === "string" && q.trim().length > 1)
            .slice(0, 4)
            .map((q) => q.trim().slice(0, 200))
        : [],
      source_hint: "issue_map",
    });
    if (out.length >= cap) break;
  }

  return { claims: out, run };
}
