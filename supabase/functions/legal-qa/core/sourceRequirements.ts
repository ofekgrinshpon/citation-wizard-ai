// Research Core v1 — Source Requirements Planner.
//
// Runs BETWEEN planner and retrieval. Purely additive — does NOT mutate the
// PlanV1 and does NOT change retrieval behavior. Produces:
//
//   1. A list of mandatory source roles per matched doctrine (statute
//      sections, leading caselaw families, key scholarship/regulations).
//   2. Canonical Hebrew search queries that, if any retrieval origin tries
//      them, should surface that role.
//   3. A reconciler (`reconcileSourceRequirements`) that, after retrieval +
//      verification, marks per role:
//        - tried_local        (any local_text/local_vector/exact_authority
//                              candidate matched a canonical query)
//        - tried_web          (any approved_web candidate matched)
//        - reached_verifier   (any matching candidate was in a retrieval pack
//                              that the verifier processed — same set today)
//
// This is telemetry for stable canonical recall validation. Downstream
// stages (retrieval, verifier, drafter, citations) are untouched.

import type {
  CandidateSource,
  ClaimId,
  PlanV1,
} from "./types.ts";
import type { ClaimRetrievalPack } from "./retrieval.ts";

export type SourceRoleKind =
  | "statute"
  | "regulation"
  | "caselaw"
  | "scholarship";

export interface MandatorySourceRole {
  /** Stable id for telemetry, e.g. "extortion:s428a". */
  role_id: string;
  doctrine_id: string;
  kind: SourceRoleKind;
  /** Short Hebrew label shown in telemetry. */
  label: string;
  /**
   * Canonical Hebrew query fragments. Reconciler does case-insensitive
   * substring match against candidate.title / .citation / .snippet.
   * Keep these specific enough to avoid false positives (e.g. include
   * the section number "428א", not just "סחיטה").
   */
  canonical_queries: string[];
}

interface DoctrineEntry {
  doctrine_id: string;
  /** Tested against the question + plan.thesis + plan.doctrinal_frame. */
  trigger: RegExp;
  roles: MandatorySourceRole[];
}

// ─── Small starter dictionary ─────────────────────────────────────────────
// Keep entries narrow and primary-source-first. Scholarship roles are
// added only where they are widely cited canon.

const DOCTRINES: DoctrineEntry[] = [
  {
    doctrine_id: "protection_money_extortion",
    trigger: /(דמי\s*חסות|סחיטה\s*באיומים|סחיטה\s*בכוח|extortion|protection\s*money|חוק\s*העונשין.*42[78])/i,
    roles: [
      {
        role_id: "extortion:s427",
        doctrine_id: "protection_money_extortion",
        kind: "statute",
        label: "ס׳ 427 לחוק העונשין — סחיטה בכוח",
        canonical_queries: ["סעיף 427", "ס׳ 427", "427 לחוק העונשין", "סחיטה בכוח"],
      },
      {
        role_id: "extortion:s428",
        doctrine_id: "protection_money_extortion",
        kind: "statute",
        label: "ס׳ 428 לחוק העונשין — סחיטה באיומים",
        canonical_queries: ["סעיף 428", "ס׳ 428", "428 לחוק העונשין", "סחיטה באיומים"],
      },
      {
        role_id: "extortion:s428a",
        doctrine_id: "protection_money_extortion",
        kind: "statute",
        label: "ס׳ 428א לחוק העונשין — גביית דמי חסות",
        canonical_queries: ["סעיף 428א", "ס׳ 428א", "428א לחוק העונשין", "דמי חסות"],
      },
    ],
  },
  {
    doctrine_id: "legislative_omission_duty_to_legislate",
    // Phase 1 — broadened to cover common Hebrew variants:
    // מחדל חקיקתי / מחדל חקיקתי חלקי / מחדל חקיקה / חובה לחוקק /
    // החובה לחוקק / סעד החובה לחוקק / חסר נורמטיבי / לקונה חקיקתית /
    // אי הסדרה / היעדר הסדרה / חקיקה לוקה בחסר.
    trigger: /(מחדל\s*חקיקתי(?:\s*חלקי)?|מחדל\s*חקיקה|(?:סעד\s*ה)?חובה\s*לחוקק|החובה\s*לחוקק|חסר\s*נורמטיבי|לקונה\s*חקיקתית|(?:אי|היעדר)[- ]?הסדרה|חקיקה\s*לוקה\s*בחסר|אי[- ]?חקיקה|legislative\s*omission|duty\s*to\s*legislate)/i,
    roles: [
      {
        role_id: "duty_legislate:bagatz_canon",
        doctrine_id: "legislative_omission_duty_to_legislate",
        kind: "caselaw",
        label: "פסיקת בג״ץ בעניין מחדלי חקיקה",
        canonical_queries: [
          "מחדל חקיקה",
          "החובה לחוקק",
          "סעד החובה לחוקק",
          "בג\"ץ רסלר",
          "ברגיל",
        ],
      },
      {
        role_id: "duty_legislate:scholarship",
        doctrine_id: "legislative_omission_duty_to_legislate",
        kind: "scholarship",
        label: "ספרות אקדמית — סעד החובה לחוקק",
        canonical_queries: ["סעד החובה לחוקק", "מחדל חקיקתי", "אקטיביזם שיפוטי מחדל חקיקה"],
      },
    ],
  },
  {
    doctrine_id: "temporary_injunction",
    trigger: /(צו\s*מניעה\s*זמני|סעד\s*זמני|תקנה\s*95)/i,
    roles: [
      {
        role_id: "temp_inj:reg95",
        doctrine_id: "temporary_injunction",
        kind: "regulation",
        label: "תקנה 95 לתקנות סדר הדין האזרחי",
        canonical_queries: ["תקנה 95", "תקנות סדר הדין האזרחי"],
      },
      {
        role_id: "temp_inj:caselaw",
        doctrine_id: "temporary_injunction",
        kind: "caselaw",
        label: "פסיקה — מאזן הנוחות וסיכויי ההליך",
        canonical_queries: [
          "מאזן הנוחות",
          "סיכויי ההליך",
          "ראיות לכאורה",
          "נזק בלתי הפיך",
        ],
      },
    ],
  },
  {
    doctrine_id: "stay_of_execution",
    trigger: /(עיכוב\s*ביצוע|stay\s*of\s*execution|תקנה\s*46[67])/i,
    roles: [
      {
        role_id: "stay:regulations",
        doctrine_id: "stay_of_execution",
        kind: "regulation",
        label: "תקנות סדר הדין האזרחי — עיכוב ביצוע",
        canonical_queries: ["תקנה 466", "תקנה 467", "עיכוב ביצוע"],
      },
      {
        role_id: "stay:caselaw",
        doctrine_id: "stay_of_execution",
        kind: "caselaw",
        label: "פסיקה — מבחני עיכוב ביצוע פסק דין כספי",
        canonical_queries: [
          "עיכוב ביצוע פסק דין",
          "סיכויי הערעור",
          "מאזן הנוחות",
          "השבת המצב לקדמותו",
        ],
      },
    ],
  },
  {
    doctrine_id: "pre_contractual_good_faith",
    trigger: /(תום\s*לב\s*במשא\s*ומתן|סעיף\s*12\s*לחוק\s*החוזים|פיצויי\s*קיום|pre[- ]?contractual)/i,
    roles: [
      {
        role_id: "precontract:s12",
        doctrine_id: "pre_contractual_good_faith",
        kind: "statute",
        label: "ס׳ 12 לחוק החוזים (חלק כללי)",
        canonical_queries: ["סעיף 12 לחוק החוזים", "ס׳ 12 לחוק החוזים", "תום לב במשא ומתן"],
      },
      {
        role_id: "precontract:caselaw",
        doctrine_id: "pre_contractual_good_faith",
        kind: "caselaw",
        label: "פסיקה — פיצויי קיום בהפרת תום הלב",
        canonical_queries: [
          "פיצויי קיום",
          "קל בנין",
          "שיכון עובדים",
          "תום לב במשא ומתן",
        ],
      },
    ],
  },
  {
    doctrine_id: "relative_voidness",
    trigger: /(בטלות\s*יחסית|relative\s*voidness|תוצאת\s*בטלות)/i,
    roles: [
      {
        role_id: "rel_void:caselaw",
        doctrine_id: "relative_voidness",
        kind: "caselaw",
        label: "פסיקה — בטלות יחסית במשפט המנהלי",
        canonical_queries: [
          "בטלות יחסית",
          "בג\"ץ בטלות יחסית",
          "תוצאת הבטלות",
        ],
      },
      {
        role_id: "rel_void:scholarship",
        doctrine_id: "relative_voidness",
        kind: "scholarship",
        label: "ספרות — בטלות יחסית (זמיר)",
        canonical_queries: ["בטלות יחסית זמיר", "הסמכות המנהלית"],
      },
    ],
  },
  {
    doctrine_id: "contract_interpretation",
    trigger: /(פרשנות\s*חוזה|אומד\s*דעת\s*הצדדים|סעיף\s*25\s*לחוק\s*החוזים|אפרופים)/i,
    roles: [
      {
        role_id: "contract_interp:s25",
        doctrine_id: "contract_interpretation",
        kind: "statute",
        label: "ס׳ 25 לחוק החוזים (חלק כללי)",
        canonical_queries: ["סעיף 25 לחוק החוזים", "ס׳ 25 לחוק החוזים", "אומד דעת הצדדים"],
      },
      {
        role_id: "contract_interp:caselaw",
        doctrine_id: "contract_interpretation",
        kind: "caselaw",
        label: "פסיקה — הלכת אפרופים / מגדלי הירקות",
        canonical_queries: ["אפרופים", "מגדלי הירקות", "פרשנות חוזה"],
      },
    ],
  },
];

// ─── API ──────────────────────────────────────────────────────────────────

export interface ClaimRoleAssignment {
  claim_id: ClaimId;
  matched_doctrines: string[];
  role_ids: string[];
}

export interface SourceRequirementsPlan {
  triggered_doctrines: string[];
  mandatory_roles: MandatorySourceRole[];
  per_claim: ClaimRoleAssignment[];
}

export interface BuildSourceRequirementsArgs {
  question: string;
  plan: PlanV1;
}

/**
 * Build the Source Requirements plan. Does NOT modify `plan`.
 */
export function buildSourceRequirements(
  args: BuildSourceRequirementsArgs,
): SourceRequirementsPlan {
  const { question, plan } = args;
  const globalHaystack = [
    question || "",
    plan.thesis || "",
    plan.doctrinal_frame || "",
  ].join(" \n ");

  const triggered: DoctrineEntry[] = [];
  const triggeredIds = new Set<string>();
  for (const d of DOCTRINES) {
    if (d.trigger.test(globalHaystack)) {
      triggered.push(d);
      triggeredIds.add(d.doctrine_id);
    }
  }

  // Per-claim doctrine match: a doctrine attaches to a claim if it triggers
  // globally AND (the claim text contains the trigger OR the doctrine
  // triggered globally and the claim text mentions any of its canonical
  // query fragments). If neither, fall back to attaching ALL globally-
  // triggered doctrines to every claim — recall is the priority here.
  const per_claim: ClaimRoleAssignment[] = plan.claims.map((c) => {
    const matched = new Set<string>();
    const claimText = c.text || "";
    for (const d of triggered) {
      if (d.trigger.test(claimText)) {
        matched.add(d.doctrine_id);
        continue;
      }
      for (const role of d.roles) {
        if (role.canonical_queries.some((q) => claimText.includes(q))) {
          matched.add(d.doctrine_id);
          break;
        }
      }
    }
    if (matched.size === 0 && triggered.length > 0) {
      for (const d of triggered) matched.add(d.doctrine_id);
    }
    const roleIds: string[] = [];
    for (const d of triggered) {
      if (!matched.has(d.doctrine_id)) continue;
      for (const r of d.roles) roleIds.push(r.role_id);
    }
    return {
      claim_id: c.id,
      matched_doctrines: [...matched],
      role_ids: roleIds,
    };
  });

  const mandatory_roles: MandatorySourceRole[] = [];
  for (const d of triggered) for (const r of d.roles) mandatory_roles.push(r);

  return {
    triggered_doctrines: [...triggeredIds],
    mandatory_roles,
    per_claim,
  };
}

// ─── Reconciliation ───────────────────────────────────────────────────────

export interface RoleRecallStatus {
  role_id: string;
  doctrine_id: string;
  kind: SourceRoleKind;
  label: string;
  tried_local: boolean;
  tried_web: boolean;
  reached_verifier: boolean;
  matched_candidate_ids: string[];
  matched_origins: string[];
}

export interface SourceRequirementsReconciliation {
  per_role: RoleRecallStatus[];
  totals: {
    roles: number;
    roles_tried_local: number;
    roles_tried_web: number;
    roles_reached_verifier: number;
    roles_missing_entirely: number;
  };
}

export interface ReconcileArgs {
  requirements: SourceRequirementsPlan;
  packs: ClaimRetrievalPack[];
}

function candidateMatchesRole(
  c: CandidateSource,
  role: MandatorySourceRole,
): boolean {
  const hay = [
    c.title || "",
    c.citation || "",
    c.snippet || "",
  ].join(" \n ").toLowerCase();
  for (const q of role.canonical_queries) {
    if (hay.includes(q.toLowerCase())) return true;
  }
  return false;
}

/**
 * Reconcile retrieval results against the source requirements plan. Today,
 * every candidate in `packs` is passed to the verifier, so
 * `reached_verifier` mirrors `tried_local || tried_web`. The field is kept
 * separate so a future verifier-side filter can flip it independently
 * without changing the reconciler shape.
 */
export function reconcileSourceRequirements(
  args: ReconcileArgs,
): SourceRequirementsReconciliation {
  const { requirements, packs } = args;

  const allCandidates: CandidateSource[] = [];
  for (const p of packs) for (const c of p.candidates) allCandidates.push(c);

  const per_role: RoleRecallStatus[] = requirements.mandatory_roles.map((role) => {
    const matchedIds: string[] = [];
    const origins = new Set<string>();
    let tried_local = false;
    let tried_web = false;
    for (const c of allCandidates) {
      if (!candidateMatchesRole(c, role)) continue;
      matchedIds.push(c.candidate_id);
      origins.add(c.origin);
      if (c.origin === "approved_web") tried_web = true;
      else tried_local = true;
    }
    return {
      role_id: role.role_id,
      doctrine_id: role.doctrine_id,
      kind: role.kind,
      label: role.label,
      tried_local,
      tried_web,
      reached_verifier: tried_local || tried_web,
      matched_candidate_ids: matchedIds.slice(0, 20),
      matched_origins: [...origins],
    };
  });

  const totals = {
    roles: per_role.length,
    roles_tried_local: per_role.filter((r) => r.tried_local).length,
    roles_tried_web: per_role.filter((r) => r.tried_web).length,
    roles_reached_verifier: per_role.filter((r) => r.reached_verifier).length,
    roles_missing_entirely: per_role.filter(
      (r) => !r.tried_local && !r.tried_web,
    ).length,
  };

  return { per_role, totals };
}

/** Compact telemetry summary for stage emitters / qa_logs.metadata. */
export function summarizeRequirements(
  reqs: SourceRequirementsPlan,
): {
  triggered: string[];
  role_count: number;
  per_claim_role_counts: Record<string, number>;
} {
  const per_claim_role_counts: Record<string, number> = {};
  for (const a of reqs.per_claim) per_claim_role_counts[a.claim_id] = a.role_ids.length;
  return {
    triggered: reqs.triggered_doctrines,
    role_count: reqs.mandatory_roles.length,
    per_claim_role_counts,
  };
}
