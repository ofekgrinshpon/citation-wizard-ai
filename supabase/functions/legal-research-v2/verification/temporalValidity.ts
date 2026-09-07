/**
 * legal-research-v2 — SAFEGUARD A: current-law / temporal validity.
 *
 * Source support alone is not enough for a proposition whose truth depends on
 * the CURRENT state of the law: an old source can genuinely support
 * "כיום אין בישראל עבירה ..." and still be wrong today.
 *
 * This module does NOT age-rank sources. Old judgments, statutes and
 * scholarship stay fully authoritative. It classifies the CLAIM, and only a
 * current-state claim needs a current-law check before it may be stated
 * categorically.
 *
 * Placement: one bounded pass between verification and drafting. No new
 * orchestration layer, no modes, no roles, no ranking.
 */

import type {
  EvidenceSource,
  TemporalStatus,
  VerifiedClaim,
  VerifiedEvidencePack,
} from "../types.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import { chat, parseJsonLoose, type UsageLedger } from "../shared/model.ts";
import { hostOf } from "../shared/primitives.ts";

/**
 * Hebrew cues for a present-tense legal-status proposition. This is a
 * BACKSTOP, not the classifier: the agent also declares `current_state_claim`
 * per claim and either signal is enough.
 */
const CURRENT_STATE_CUES: RegExp[] = [
  /\bכיום\b/u,
  /נכון להיום/u,
  /נכון למועד/u,
  /המצב המשפטי הנוכחי/u,
  /הדין החל/u,
  /ההסדר החל/u,
  /(?:אין|לא קיימת?|לא קיים)\s+(?:כיום\s+)?(?:בישראל\s+)?(?:עבירה|הסדר|חוק|הוראה|איסור|סעיף|הגדרה)/u,
  /טרם\s+(?:נחקק|תוקן|בוטל|הוסדר)/u,
  /(?:נחקק|תוקן|בוטל|הוחלף)\s/u,
  /(?:תלויה ועומדת|הצעת חוק)/u,
  /(?:החוק|הסעיף|התקנות)\s+(?:קובע|קובעת|קובעים)\s+כיום/u,
  /העונש\s+(?:הקבוע|כיום)/u,
];

export function isCurrentStateProposition(text: string): boolean {
  const t = (text ?? "").replace(/\s+/g, " ");
  return CURRENT_STATE_CUES.some((re) => re.test(t));
}

/** Claim is temporally sensitive if the agent said so OR a cue fires. */
export function isTemporallySensitive(
  claim: { proposition: string; current_state_claim?: boolean },
): boolean {
  return claim.current_state_claim === true || isCurrentStateProposition(claim.proposition);
}

const LEGISLATION_HOST_HINTS = [
  "knesset.gov.il",
  "main.knesset.gov.il",
  "fs.knesset.gov.il",
  "gov.il",
  "justice.gov.il",
  "nevo.co.il",
  "court.gov.il",
];

/**
 * Can this document establish PRESENT legal status? Official legislation /
 * legislative material / official judgment text can; a research paper, blog or
 * summary cannot, regardless of its date.
 */
export function isCurrentLawCapable(source: EvidenceSource): boolean {
  if (source.fetch_status !== "ok" || !source.is_actual_document) return false;
  const host = source.url ? hostOf(source.url) : "";
  const officialHost = LEGISLATION_HOST_HINTS.some((h) => host.endsWith(h));
  if (!officialHost) return false;
  const text = `${source.title}\n${source.extracted_text.slice(0, 4_000)}`;
  const carriesLawText = /חוק|פקודת|תקנות|תיקון מס|ספר החוקים|נוסח משולב/u.test(text) ||
    source.identity_fields.statutes.length > 0 ||
    source.identity_fields.dockets.length > 0;
  return carriesLawText;
}

export interface TemporalAssessment {
  claim_id: string;
  temporal_status: TemporalStatus;
  detail: string;
  checked_source_ids: string[];
}

export interface TemporalCounters {
  temporal_sensitive_claims: number;
  temporal_checks_attempted: number;
  temporal_current_verified: number;
  temporal_unresolved: number;
  temporal_contradicted: number;
  temporal_repairs: number;
}

export function newTemporalCounters(): TemporalCounters {
  return {
    temporal_sensitive_claims: 0,
    temporal_checks_attempted: 0,
    temporal_current_verified: 0,
    temporal_unresolved: 0,
    temporal_contradicted: 0,
    temporal_repairs: 0,
  };
}

const SYSTEM =
  `אתה בודק תוקף עדכני של טענות משפטיות. לכל טענה שמנוסחת כמצב הדין הנוכחי, נתונים לך קטעי טקסט ממקורות רשמיים שנקראו בפועל.
קבע:
"current_verified" — קיים במקורות טקסט רשמי המבסס את המצב הנוכחי כפי שנטען.
"contradicted" — הטקסט הרשמי סותר את הטענה (למשל נחקקה הוראה שהטענה מכחישה את קיומה).
"unresolved" — אין במקורות בסיס רשמי לקבוע את המצב הנוכחי.
אל תסתמך על ידע חיצוני ואל תנחש. היעדר ראיה עדכנית הוא "unresolved" ולא "current_verified". נמק בקצרה בעברית.`;

const TOOL = {
  name: "report_temporal_status",
  description: "דיווח מצב תוקף עדכני לכל טענה.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            claim_id: { type: "string" },
            temporal_status: {
              type: "string",
              enum: ["current_verified", "unresolved", "contradicted"],
            },
            reason: { type: "string" },
          },
          required: ["claim_id", "temporal_status", "reason"],
        },
      },
    },
    required: ["verdicts"],
  },
};

/** One bounded batched check over the temporally sensitive verified claims. */
export async function assessTemporalValidity(opts: {
  pack: VerifiedEvidencePack;
  store: EvidenceStore;
  model: string;
  usage: UsageLedger;
  sensitive?: (claim: VerifiedClaim) => boolean;
}): Promise<{ assessments: TemporalAssessment[]; counters: TemporalCounters }> {
  const counters = newTemporalCounters();
  const isSensitive = opts.sensitive ?? ((c: VerifiedClaim) => isTemporallySensitive(c));
  const sensitive = opts.pack.claims.filter(isSensitive);
  counters.temporal_sensitive_claims = sensitive.length;
  if (!sensitive.length) return { assessments: [], counters };

  const capable = opts.store.all().filter(isCurrentLawCapable).slice(0, 4);
  const assessments: TemporalAssessment[] = [];

  // No current-law-capable document was read at all: nothing to check against.
  if (!capable.length) {
    for (const c of sensitive) {
      assessments.push({
        claim_id: c.claim_id,
        temporal_status: "unresolved",
        detail: "לא נקרא מקור רשמי המאפשר לקבוע את מצב הדין הנוכחי",
        checked_source_ids: [],
      });
      counters.temporal_unresolved += 1;
    }
    return { assessments, counters };
  }

  counters.temporal_checks_attempted = sensitive.length;
  const evidenceText = capable
    .map((s) => `מקור ${s.source_id} | ${s.title.slice(0, 120)} | ${s.url ?? ""}\n${
      s.extracted_text.slice(0, 2_500)
    }`)
    .join("\n\n---\n\n");
  const claimsText = sensitive
    .map((c) => `claim_id: ${c.claim_id}\nטענה (מנוסחת כמצב הדין הנוכחי): ${c.proposition}`)
    .join("\n\n");

  const res = await chat({
    model: opts.model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `${claimsText}\n\n=== טקסט רשמי שנקרא ===\n${evidenceText}` },
    ],
    tools: [TOOL],
    toolChoice: { name: TOOL.name },
    usage: opts.usage,
  });

  const parsed = res.ok
    ? parseJsonLoose<{ verdicts?: Array<Record<string, unknown>> }>(
      res.tool_calls[0]?.arguments ?? res.content,
    )
    : null;
  const byId = new Map<string, { status: TemporalStatus; reason: string }>();
  for (const v of parsed?.verdicts ?? []) {
    const status = String(v.temporal_status ?? "");
    byId.set(String(v.claim_id ?? ""), {
      status: status === "current_verified" || status === "contradicted"
        ? status as TemporalStatus
        : "unresolved",
      reason: String(v.reason ?? ""),
    });
  }

  const checked = capable.map((s) => s.source_id);
  for (const c of sensitive) {
    const v = byId.get(c.claim_id);
    const status: TemporalStatus = v?.status ?? "unresolved";
    assessments.push({
      claim_id: c.claim_id,
      temporal_status: status,
      detail: v?.reason || "לא התקבלה פסיקת תוקף עדכני",
      checked_source_ids: checked,
    });
    if (status === "current_verified") counters.temporal_current_verified += 1;
    else if (status === "contradicted") counters.temporal_contradicted += 1;
    else counters.temporal_unresolved += 1;
  }
  return { assessments, counters };
}

/**
 * Gate: a current-state claim that is not `current_verified` never reaches the
 * drafter as a categorical proposition. It becomes an explicit gap instead —
 * missing is better than wrong.
 */
export function applyTemporalGate(
  pack: VerifiedEvidencePack,
  assessments: TemporalAssessment[],
): { pack: VerifiedEvidencePack; advisories: string[] } {
  if (!assessments.length) return { pack, advisories: [] };
  const byId = new Map(assessments.map((a) => [a.claim_id, a]));
  const claims: VerifiedClaim[] = [];
  const unsupported = [...pack.unsupported_claims];
  const advisories: string[] = [];

  for (const c of pack.claims) {
    const a = byId.get(c.claim_id);
    if (!a || a.temporal_status === "current_verified") {
      claims.push(a ? { ...c, temporal_status: "current_verified" } : c);
      continue;
    }
    unsupported.push({
      claim_id: c.claim_id,
      proposition: c.proposition,
      importance: c.importance,
      reasons: [`temporal_${a.temporal_status}: ${a.detail}`],
    });
    advisories.push(
      a.temporal_status === "contradicted"
        ? `הטענה "${
          c.proposition.slice(0, 120)
        }" נוסחה כמצב הדין הנוכחי אך נסתרה מול מקור רשמי עדכני — אין לכלול אותה בתשובה.`
        : `לא ניתן היה לאמת את מצב הדין הנוכחי בעניין: "${
          c.proposition.slice(0, 120)
        }". יש לציין במפורש שהמצב העדכני לא אומת, ולא לחזור על הקביעה כאילו היא הדין היום.`,
    );
  }
  return { pack: { claims, unsupported_claims: unsupported }, advisories };
}

/** Targeted repair instruction for contradicted / unresolved current-state claims. */
export function buildTemporalRepairMessage(assessments: TemporalAssessment[]): string {
  const rows = assessments
    .filter((a) => a.temporal_status !== "current_verified")
    .map((a) => `- ${a.claim_id}: ${a.temporal_status} — ${a.detail}`)
    .join("\n");
  if (!rows) return "";
  return `בדיקת תוקף עדכני העלתה בעיה בטענות שמנוסחות כמצב הדין הנוכחי:
${rows}

סבב מחקר ממוקד אחד בלבד: אתר וקרא את נוסח החקיקה העדכני או מקור חקיקתי רשמי עדכני אחר שיכול לקבוע מה הדין כיום, והגש תזכיר מתוקן.
אם הדין השתנה — נסח מחדש את הטענה לפי הדין הנוכחי והבא ציטוט מאומת מהמקור העדכני.
אם לא ניתן לקבוע את המצב הנוכחי — אל תנסח את הטענה כמצב נוכחי; ניתן לשמור אותה כטענה היסטורית מפורשת ("בשנת ... צוין כי...") או להעבירה ל-unresolved_questions.`;
}
