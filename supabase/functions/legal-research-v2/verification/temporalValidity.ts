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
import {
  buildClaimTemporalEvidence,
  renderClaimEvidence,
} from "./temporalEvidence.ts";

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

// Keep the established Israeli source policy, including Nevo as an accepted
// legal-text publisher. Do not turn this into a general web/europa.eu allowlist.
const ISRAEL_LEGISLATION_HOSTS = [
  "knesset.gov.il",
  "gov.il",
  "nevo.co.il",
  "court.gov.il",
];

const EU_CUES = /האיחוד האירופי|הדין האירופי|\b(?:EU|European Union|GDPR|EDPB|EUR[ -]?Lex|CJEU)\b|2016\/679/iu;
const ISRAEL_CUES = /ישראל|\bIsrael(?:i)?\b/iu;
// Foreign regimes outside the bounded policy must not inherit the Israel
// default. Unknown unqualified claims retain the existing Israel default;
// qualifying a claim's jurisdiction is the research agent's responsibility.
const OTHER_JURISDICTION_CUES = /ארצות הברית|ארה[״"]ב|בריטניה|אנגליה|קנדה|אוסטרליה|גרמניה|צרפת|הודו|\b(?:US|USA|U\.S\.|United States|American|UK|U\.K\.|United Kingdom|British|English law|Canada|Canadian|Australia|Australian|Germany|German|France|French|India|Indian|ECHR|ECtHR)\b/iu;
const DATA_PROTECTION_CUES = /הגנת (?:ה)?(?:מידע|נתונים|פרטיות)|פרטיות|\b(?:GDPR|data protection|personal data|privacy)\b/iu;

type ClaimJurisdiction = "israel" | "eu" | "unsupported_or_mixed";

/** Use the individual proposition, NEVER the whole mixed-jurisdiction run. */
function claimJurisdiction(proposition: string): ClaimJurisdiction {
  const eu = EU_CUES.test(proposition);
  const israel = ISRAEL_CUES.test(proposition);
  if (OTHER_JURISDICTION_CUES.test(proposition) || (eu && israel)) {
    // A composite proposition cannot be cleared by one jurisdiction's text.
    // It needs separate claims before either can receive a current-law verdict.
    return "unsupported_or_mixed";
  }
  return eu ? "eu" : "israel";
}

function isHost(host: string, expected: string): boolean {
  return host === expected || host.endsWith(`.${expected}`);
}

/** Only direct EUR-Lex document bodies, never summaries/search/landing pages. */
function isEurLexDocumentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /^\/legal-content\/[a-z]{2}\/TXT(?:\/(?:PDF|HTML))?\/?$/i.test(parsed.pathname) &&
      /^CELEX:[0-9][0-9a-z()._/-]+$/i.test(parsed.searchParams.get("uri") ?? "");
  } catch {
    return false;
  }
}

/** Bounded current/legacy EDPB publication routes and named guidance PDFs. */
function isEdpbDocumentUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /^\/(?:system\/files|sites\/default\/files)\//i.test(path) &&
      /\/edpb[^/]*(?:guidelines?|recommendations?|opinions?|decisions?)[^/]*\.pdf$/i.test(path) &&
      !/(?:summary|news|announcement|press[-_]?release)/i.test(path);
  } catch {
    return false;
  }
}

/**
 * Is this a candidate official/legal text for THIS claim's jurisdiction/topic?
 * Eligibility is not a current-law verdict: dates, amendments, commencement,
 * supersession and the limited legal effect of guidance still need the temporal
 * check below. In particular a fetched-at timestamp never establishes currency.
 */
export function isCurrentLawCapable(
  source: EvidenceSource,
  claim?: Pick<VerifiedClaim, "proposition">,
): boolean {
  if (source.fetch_status !== "ok" || !source.is_actual_document) return false;
  const host = source.url ? hostOf(source.url).toLowerCase() : "";
  const jurisdiction = claimJurisdiction(claim?.proposition ?? "");
  const text = `${source.title}\n${source.extracted_text.slice(0, 4_000)}`;

  if (jurisdiction === "israel") {
    if (!ISRAEL_LEGISLATION_HOSTS.some((h) => isHost(host, h))) return false;
    return /חוק|פקודת|תקנות|תיקון מס|ספר החוקים|נוסח משולב/u.test(text) ||
      source.identity_fields.statutes.length > 0 ||
      source.identity_fields.dockets.length > 0;
  }
  if (jurisdiction !== "eu") return false;

  // EUR-Lex publishes primary EU law. No other europa.eu website inherits this.
  if (isHost(host, "eur-lex.europa.eu")) {
    return isEurLexDocumentUrl(source.url ?? "") &&
      /\b(?:regulation|directive|decision|treaty|judgment|official journal)\b|תקנה|דירקטיבה|החלטה|אמנה|פסק דין/iu.test(text);
  }
  // EDPB is relevant to EU data-protection guidance, not every EU legal topic.
  // Guidance is official evidence, not itself proof of a statute's legal status.
  if (isHost(host, "edpb.europa.eu")) {
    return isEdpbDocumentUrl(source.url ?? "") &&
      DATA_PROTECTION_CUES.test(claim?.proposition ?? "") &&
      DATA_PROTECTION_CUES.test(text) &&
      /\b(?:guidelines?|recommendations?|opinions?|decisions?)\b|הנחיות|המלצות|חוות דעת|החלטה/iu.test(text);
  }
  return false;
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
בדוק תחולה בזמן, מועד כניסה לתוקף, תיקונים וביטול לפי הטקסט שסופק; תאריך שליפה אינו ראיה לעדכניות. הנחיות רגולטוריות אינן כשלעצמן חקיקה ואינן מוכיחות כניסה לתוקף או תיקון של חוק.
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

  const assessments: TemporalAssessment[] = [];

  // Claim-specific relevant evidence: the verified span and, when the claim
  // names a statute section, the located section window from the SAME source.
  // A claim with a capable supporting source but no precise excerpt gets a
  // bounded prefix of THAT source only. A claim with no current-law-capable
  // supporting evidence at all is deterministically `unresolved` — it is
  // NEVER shown prefixes of unrelated official sources from elsewhere in
  // the run (each current-state claim is judged only against evidence
  // relevant to that claim).
  const packets = sensitive.map((c) => buildClaimTemporalEvidence(c, opts.store));
  const byClaimPacket = new Map(packets.map((p) => [p.claim_id, p]));

  const checkable: VerifiedClaim[] = [];
  for (const c of sensitive) {
    const packet = byClaimPacket.get(c.claim_id)!;
    if (!packet.excerpts.length) {
      assessments.push({
        claim_id: c.claim_id,
        temporal_status: "unresolved",
        detail: "לא נמצאה ראיה ממקור רשמי עדכני התומכת בטענה זו — לא ניתן לקבוע את מצב הדין הנוכחי",
        checked_source_ids: [],
      });
      counters.temporal_unresolved += 1;
      continue;
    }
    checkable.push(c);
  }
  if (!checkable.length) return { assessments, counters };

  counters.temporal_checks_attempted = checkable.length;

  const blocks = checkable.map((c) => {
    const packet = byClaimPacket.get(c.claim_id)!;
    return `claim_id: ${c.claim_id}\nטענה (מנוסחת כמצב הדין הנוכחי): ${c.proposition}\n--- טקסט רשמי רלוונטי לטענה ${c.claim_id} בלבד ---\n${
      renderClaimEvidence(packet)
    }`;
  });

  const res = await chat({
    model: opts.model,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `לכל טענה מצורפים קטעי הטקסט הרשמי הרלוונטיים לאותה טענה בלבד. הערך כל טענה אך ורק מול הקטעים המופיעים תחתיה, ואל תסיק לגבי טענה אחת מקטעים של טענה אחרת.\n\n${
            blocks.join("\n\n=====\n\n")
          }`,
      },
    ],
    tools: [TOOL],
    toolChoice: { name: TOOL.name },
    usage: opts.usage,
    costStage: "v2_temporal_validity",
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

  for (const c of checkable) {
    const v = byId.get(c.claim_id);
    const status: TemporalStatus = v?.status ?? "unresolved";
    assessments.push({
      claim_id: c.claim_id,
      temporal_status: status,
      detail: v?.reason || "לא התקבלה פסיקת תוקף עדכני",
      checked_source_ids: byClaimPacket.get(c.claim_id)?.source_ids ?? [],
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
