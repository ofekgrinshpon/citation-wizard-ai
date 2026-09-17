/**
 * legal-research-v2 — deterministic commit / stop discipline.
 *
 * The research agent still decides substantive sufficiency. This module only
 * decides *when the orchestrator says something* about committing:
 *
 *   • early commit signal   — "you may already have enough; commit or name the gap"
 *   • named-authority hint  — the explicitly named judgment/statute body is in hand
 *   • stale-research signal — repeated work is producing no new evidence
 *   • mandatory commit      — the research phase is over, submit the memo now
 *
 * No sufficiency framework, no ranking, no rescue stage.
 */

import type { EvidenceSource, Intake } from "../types.ts";

export interface CommitSignals {
  readable_count: number;
  obligations_total: number;
  obligations_satisfied: number;
  stale_streak: number;
  research_steps_left: number;
  /**
   * Authorities the agent itself chose to pursue that are still unacquired and
   * still have untried candidates. Information for the stale signal only —
   * never a completion condition and never a forced action.
   */
  unresolved_targets?: Array<{ authority_key: string; untried: number }>;
}

export type CommitDirectiveKind =
  | "named_authority_ready"
  | "early_commit"
  | "stale_research"
  | "mandatory_commit";

export interface CommitDirective {
  kind: CommitDirectiveKind;
  text: string;
}

/** How many of the question's explicit obligations are backed by a read body. */
export function obligationsSatisfied(intake: Intake, readable: EvidenceSource[]): number {
  let n = 0;
  for (const d of intake.docket_obligations) {
    const num = d.display.match(/\d{1,6}\/\d{2,4}/)?.[0] ?? d.display;
    if (readable.some((s) => s.identity_fields.dockets.includes(num) || s.extracted_text.includes(num))) n += 1;
  }
  for (const st of intake.statute_obligations) {
    if (
      readable.some((s) =>
        s.identity_fields.statutes.some((x) => x.includes(st.statute) || st.statute.includes(x)) ||
        s.extracted_text.includes(st.statute)
      )
    ) n += 1;
  }
  return n;
}

const MANDATORY_TEXT =
  "עצור את המחקר. שלב איסוף הראיות הסתיים. בהתבסס אך ורק על המסמכים שכבר נקראו בריצה זו, קרא עכשיו ל-submit_research_memo והגש את התזכיר הטוב ביותר האפשרי. סמן במפורש ב-unresolved_questions כל טענה שלא ניתן לבסס. אל תקרא ליותר אף כלי מחקר.";

const EARLY_TEXT =
  "קראת עד כה מספר מסמכים. מספר המסמכים כשלעצמו אינו מעיד על מספיקות. בחן מחדש את בקשת המשתמש בפועל ואת הראיות שבידך: אם כל הממדים המהותיים הנדרשים לאותה בקשה מבוססים דיים — הגש עכשיו את תזכיר המחקר (submit_research_memo). אם לא — נסח לעצמך פער מחקרי מהותי וקונקרטי אחד, והמשך לחקור ממוקד אליו.";

function namedText(readyList: string): string {
  return `גוף האסמכתה שנדרשה במפורש (${readyList}) הובא ונקרא בפועל. זו אינה בהכרח השלמת המשימה: בחן מחדש את בקשת המשתמש במלואה. אם אסמכתה זו יחד עם שאר הראיות מספיקה לכל מה שהתבקש — הגש עכשיו את תזכיר המחקר. אחרת המשך רק לעבר צרכי מחקר קונקרטיים שנותרו.`;
}

const STALE_TEXT =
  "החיפושים והבאות האחרונים לא הוסיפו ראיות חדשות. הפסק לחזור על אותה דרך: או שתגיש את תזכיר המחקר עם מה שכבר נקרא, או שתנסח שאילתה שונה מהותית.";

/**
 * Same anti-loop signal, but it also reminds the agent of acquisition targets
 * IT chose that were never obtained and still have untried candidates. The
 * options are listed; the choice among them stays with the agent.
 */
export function staleText(targets?: Array<{ authority_key: string; untried: number }>): string {
  const open = (targets ?? []).filter((t) => t.untried > 0);
  if (!open.length) return STALE_TEXT;
  const list = open.map((t) => `${t.authority_key} (${t.untried} מועמדים שטרם נוסו)`).join(", ");
  return `${STALE_TEXT}\nלידיעתך, אסמכתאות שביקשת לאתר וטרם הושגו: ${list}. באפשרותך: להביא אחד מהמועמדים שטרם נוסו (fetch לפי result_id), לחפש נתיב השגה אחר, לוותר על היעד הזה במפורש אם אינו נחוץ עוד, או להגיש את התזכיר אם הראיות שכבר אומתו מספיקות לשאלה. ההחלטה שלך — אין חובה להשיג אסמכתה זו.`;
}

export class CommitTracker {
  private issued = new Set<CommitDirectiveKind>();
  private repeats = new Map<string, number>();
  /** Consecutive tool rounds that produced no newly read document. */
  stale_streak = 0;

  /** Count a tool call key; return a warning when it is being repeated. */
  noteToolKey(key: string): string | null {
    const n = (this.repeats.get(key) ?? 0) + 1;
    this.repeats.set(key, n);
    if (n === 2) {
      return "אזהרה: קריאה זו כבר בוצעה בריצה זו והחזירה את אותו חומר. אל תחזור עליה שוב.";
    }
    if (n > 2) {
      return "אזהרה: קריאה זו חוזרת על עצמה שוב ושוב ואינה מייצרת ראיות חדשות. עבור לצעד שונה מהותית או הגש את התזכיר.";
    }
    return null;
  }

  /** How many times this exact call has been made in the run. */
  repeatCount(key: string): number {
    return this.repeats.get(key) ?? 0;
  }

  noteRound(producedNewEvidence: boolean): void {
    this.stale_streak = producedNewEvidence ? 0 : this.stale_streak + 1;
  }

  /** The single directive (if any) to append after the current tool round. */
  directive(s: CommitSignals): CommitDirective | null {
    if (s.research_steps_left <= 0) return { kind: "mandatory_commit", text: MANDATORY_TEXT };
    if (s.research_steps_left <= 2 && !this.issued.has("mandatory_commit")) {
      this.issued.add("mandatory_commit");
      return { kind: "mandatory_commit", text: MANDATORY_TEXT };
    }
    if (
      s.obligations_total > 0 && s.obligations_satisfied >= s.obligations_total &&
      !this.issued.has("named_authority_ready")
    ) {
      this.issued.add("named_authority_ready");
      return { kind: "named_authority_ready", text: namedText(`${s.obligations_satisfied}/${s.obligations_total}`) };
    }
    if (s.readable_count >= 3 && !this.issued.has("early_commit")) {
      this.issued.add("early_commit");
      return {
        kind: "early_commit",
        text: EARLY_TEXT,
      };
    }
    // Re-issued while the run keeps producing nothing AND an acquisition
    // target the agent chose is still open: the reminder must survive context
    // compaction. It still only lists options.
    const openTargets = (s.unresolved_targets ?? []).some((t) => t.untried > 0);
    const repeatStale = openTargets && s.stale_streak >= 4 && s.stale_streak % 2 === 0;
    if (s.stale_streak >= 2 && (!this.issued.has("stale_research") || repeatStale)) {
      this.issued.add("stale_research");
      return { kind: "stale_research", text: staleText(s.unresolved_targets) };
    }
    return null;
  }

  toJSON() {
    return {
      issued: [...this.issued],
      repeats: [...this.repeats.entries()],
      stale_streak: this.stale_streak,
    };
  }

  static fromJSON(json: ReturnType<CommitTracker["toJSON"]> | null | undefined): CommitTracker {
    const t = new CommitTracker();
    for (const k of json?.issued ?? []) t.issued.add(k as CommitDirectiveKind);
    for (const [k, v] of json?.repeats ?? []) t.repeats.set(k, v);
    t.stale_streak = json?.stale_streak ?? 0;
    return t;
  }
}
