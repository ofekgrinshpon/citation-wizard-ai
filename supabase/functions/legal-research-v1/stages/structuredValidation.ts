// V2.1 — validation for the structured drafter output.
// Rejects ANYTHING that would let the model emit citation markup itself.

/** claim_source_match_validation_v1 — optional per-block claim tags. */
export interface BlockClaimTags {
  claim_id?: string | null;
  facet_id?: string | null;
  proposition_type?:
    | "black_letter_rule"
    | "application"
    | "background"
    | "practical_guidance"
    | "limitation"
    | null;
  legal_area?: string | null;
}

export type StructuredBlock =
  | { kind: "heading"; level: 2 | 3; text: string }
  | ({ kind: "paragraph"; text: string; source_refs: string[] } & BlockClaimTags)
  | ({ kind: "list_item"; text: string; source_refs: string[] } & BlockClaimTags);

export interface StructuredDraft {
  blocks: StructuredBlock[];
}


export interface StructuredValidation {
  ok: boolean;
  errors: string[];
  // counts for telemetry
  block_count: number;
  paragraph_count: number;
  list_item_count: number;
  heading_count: number;
  cited_segment_count: number;
  total_source_ref_count: number;
  unknown_source_refs: string[];
  forbidden_text_hits: Array<{ kind: string; sample: string }>;
}

// Forbidden patterns in segment.text (V2 forbids model-emitted markers).
const SUPERSCRIPT_RE = /[\u00B2\u00B3\u00B9\u2070-\u209F]/u;
const TOKEN_RE = /\[\[fn:\d+\]\]/;
const BRACKET_NUM_RE = /\[\d+\]/;
const PAREN_SUP_RE = /[\u207D\u207E]/u; // ⁽ ⁾

export function validateStructuredDraft(
  raw: unknown,
  allowedRefs: Set<string>,
): { draft: StructuredDraft | null; report: StructuredValidation } {
  const errors: string[] = [];
  const forbidden: Array<{ kind: string; sample: string }> = [];
  const unknownRefs = new Set<string>();

  const r = (raw ?? {}) as { blocks?: unknown };
  const blocksRaw = Array.isArray(r.blocks) ? r.blocks : null;
  if (!blocksRaw) {
    errors.push("blocks is not an array");
    return {
      draft: null,
      report: {
        ok: false,
        errors,
        block_count: 0,
        paragraph_count: 0,
        list_item_count: 0,
        heading_count: 0,
        cited_segment_count: 0,
        total_source_ref_count: 0,
        unknown_source_refs: [],
        forbidden_text_hits: [],
      },
    };
  }

  const blocks: StructuredBlock[] = [];
  let paragraph_count = 0;
  let list_item_count = 0;
  let heading_count = 0;
  let cited_segment_count = 0;
  let total_source_ref_count = 0;

  const checkText = (text: string, idx: number): boolean => {
    let bad = false;
    const m1 = SUPERSCRIPT_RE.exec(text);
    if (m1) {
      forbidden.push({ kind: "superscript", sample: text.slice(Math.max(0, m1.index - 12), m1.index + 12) });
      errors.push(`block[${idx}] contains superscript`);
      bad = true;
    }
    const m2 = TOKEN_RE.exec(text);
    if (m2) {
      forbidden.push({ kind: "fn_token", sample: m2[0] });
      errors.push(`block[${idx}] contains [[fn:N]] token`);
      bad = true;
    }
    const m3 = BRACKET_NUM_RE.exec(text);
    if (m3) {
      forbidden.push({ kind: "bracket_num", sample: m3[0] });
      errors.push(`block[${idx}] contains [N] bracket marker`);
      bad = true;
    }
    if (PAREN_SUP_RE.test(text)) {
      forbidden.push({ kind: "paren_sup", sample: "⁽⁾" });
      errors.push(`block[${idx}] contains superscript parens`);
      bad = true;
    }
    return !bad;
  };

  blocksRaw.forEach((b, idx) => {
    const o = (b ?? {}) as Record<string, unknown>;
    const kind = o.kind;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) {
      errors.push(`block[${idx}] missing text`);
      return;
    }
    if (kind === "heading") {
      const level = o.level === 3 ? 3 : 2;
      if (!checkText(text, idx)) return;
      heading_count++;
      blocks.push({ kind: "heading", level, text });
    } else if (kind === "paragraph" || kind === "list_item") {
      if (!checkText(text, idx)) return;
      const refsRaw = Array.isArray(o.source_refs) ? o.source_refs : [];
      const refs: string[] = [];
      for (const x of refsRaw) {
        if (typeof x !== "string") continue;
        const ref = x.trim();
        if (!ref) continue;
        if (!allowedRefs.has(ref)) {
          unknownRefs.add(ref);
          errors.push(`block[${idx}] unknown source_ref: ${ref}`);
          continue;
        }
        refs.push(ref);
      }
      total_source_ref_count += refs.length;
      if (refs.length > 0) cited_segment_count++;
      if (kind === "paragraph") {
        paragraph_count++;
        blocks.push({ kind: "paragraph", text, source_refs: refs });
      } else {
        list_item_count++;
        blocks.push({ kind: "list_item", text, source_refs: refs });
      }
    } else {
      errors.push(`block[${idx}] unknown kind: ${String(kind)}`);
    }
  });

  if (blocks.length === 0) errors.push("no valid blocks");
  if (cited_segment_count === 0) errors.push("no cited segments");

  const ok = errors.length === 0;
  return {
    draft: ok ? { blocks } : null,
    report: {
      ok,
      errors,
      block_count: blocks.length,
      paragraph_count,
      list_item_count,
      heading_count,
      cited_segment_count,
      total_source_ref_count,
      unknown_source_refs: [...unknownRefs],
      forbidden_text_hits: forbidden.slice(0, 10),
    },
  };
}
