/**
 * Stage 3 of the foreign free-form plan — choosing between foreign case
 * records in the app. Pure, no IO.
 *
 * A choice is built only from complete, validated decision/location records
 * returned by the earlier lookup. Each option carries its record id; choosing
 * it re-runs the same acceptance boundary on that record alone, so nothing is
 * searched again and no field comes from another record.
 *
 * The choice is bound to a fingerprint of the original input. If the input
 * no longer matches (it was edited or replaced), the choice is rejected.
 */
import { citationBindingText } from "../../supabase/functions/_shared/pastedCitation";
import {
  decisionLabel, formatLocationLabel, groundDecisionFields, orderDecisionsForChoice, readDecisionRecord, selectableLocations,
  type CaseDecisionRecord, type CaseJurisdiction,
} from "../../supabase/functions/_shared/citationPure/caseLocations.ts";
import { escapeCitationLiteral } from "@/lib/citationSegments";
import type { TypedPlan } from "@/lib/citationPlanner";
import { countryOptionResponse, type CountryDecision, type CountryLookupRequest } from "../../supabase/functions/_shared/citationPure/countryLookup.ts";

export interface ForeignCaseChoiceOption { id: string; label: string; url: string }

export interface ForeignCaseChoice {
  version: 1;
  /** "decision": several rulings; "location": parallel reports of one ruling. */
  stage: "decision" | "location";
  jurisdiction: CaseJurisdiction | "AU" | "CA";
  /** Fingerprint of the bound original input. */
  fingerprint: string;
  options: ForeignCaseChoiceOption[];
  /** Validated decision records the options were built from. */
  decisions: CaseDecisionRecord[];
  /** In-memory snapshot of the request plan and lookup response; never persisted. */
  plan: TypedPlan;
  response: Record<string, unknown>;
  pastedCitation?: unknown;
  /** AU/CA bounded completion: validated per-template records (decisions stays empty). */
  country?: { request: CountryLookupRequest; decisions: CountryDecision[] };
}

const MAX_OPTIONS = 5;

/** FNV-1a 32-bit over the binding form of the input. Stable across whitespace/quote variants only. */
export function inputFingerprint(raw: string): string {
  const text = `v1|${citationBindingText(raw)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function decisionChoiceReply(options: ForeignCaseChoiceOption[]): string {
  return `נמצאו כמה פסקי דין אפשריים בשם זה. כדי לא לנחש, בחרו את הנכון:\n${options.map((o, i) => escapeCitationLiteral(`${i + 1}. ${o.label} — ${o.url}`)).join("\n")}`;
}
export function locationChoiceReply(options: ForeignCaseChoiceOption[]): string {
  return `נמצאו כמה מראי מקום מקבילים לאותו פסק דין. כלל הקדימות ביניהם טרם אומת, ולכן לא נבחר אחד מהם אוטומטית. בחרו את מראה המקום הרצוי:\n${options.map((o, i) => escapeCitationLiteral(`${i + 1}. ${o.label} — ${o.url}`)).join("\n")}`;
}

function locationOptions(d: CaseDecisionRecord): ForeignCaseChoiceOption[] {
  return selectableLocations(d).slice(0, MAX_OPTIONS).map((l) => ({ id: l.id, label: formatLocationLabel(l), url: l.sourceUrl }));
}

/**
 * Build a choice from an untrusted lookup response. Returns null unless every
 * record is valid; the caller then keeps the plain text list.
 */
export function buildForeignCaseChoice(plan: TypedPlan, response: unknown, pastedCitation: unknown, stage: "decision" | "location"): ForeignCaseChoice | null {
  const req = plan.foreignLookup;
  if (!req || req.kind !== "case") return null;
  const r = record(response);
  const jurisdiction = record(r.identity).jurisdiction ?? r.jurisdiction;
  if (jurisdiction !== "US" && jurisdiction !== "UK") return null;
  if (!Array.isArray(r.caseDecisions)) return null;
  const decisions: CaseDecisionRecord[] = [];
  for (const raw of r.caseDecisions) {
    const d = readDecisionRecord(raw, jurisdiction);
    if (!d) return null;
    decisions.push(d);
  }
  if (new Set(decisions.map((d) => d.id)).size !== decisions.length) return null;
  let options: ForeignCaseChoiceOption[];
  if (stage === "decision") {
    if (decisions.length < 2) return null;
    options = orderDecisionsForChoice(decisions).slice(0, MAX_OPTIONS).map((d) => ({
      id: d.id, label: decisionLabel(d), url: d.locations[0]?.sourceUrl ?? d.neutralSourceUrl ?? d.sourceUrls[0],
    }));
    if (options.some((o) => !o.url)) return null;
  } else {
    if (decisions.length !== 1) return null;
    options = locationOptions(decisions[0]);
    if (options.length < 2) return null;
  }
  return {
    version: 1, stage, jurisdiction, fingerprint: inputFingerprint(plan.evidence.pasted.contract.rawInput),
    options, decisions, plan, response: r, ...(pastedCitation !== undefined ? { pastedCitation } : {}),
  };
}

const countryOptions = (stage: "decision" | "location", decisions: CountryDecision[]): ForeignCaseChoiceOption[] => stage === "decision"
  ? decisions.slice(0, MAX_OPTIONS).map((d) => ({ id: d.id, label: d.label, url: Object.values(d.options[0].sources)[0].url }))
  : decisions[0].options.slice(0, MAX_OPTIONS).map((o) => ({ id: o.id, label: o.label, url: Object.values(o.sources)[0].url }));

/** AU/CA choice from records already validated by `acceptCountryResponse` (no IO). */
export function buildCountryCaseChoice(plan: TypedPlan, request: CountryLookupRequest, response: unknown, pastedCitation: unknown,
  stage: "decision" | "location", decisions: CountryDecision[]): ForeignCaseChoice | null {
  if (!decisions.length || (stage === "location" && (decisions.length !== 1 || decisions[0].options.length < 2)) || (stage === "decision" && decisions.length < 2)) return null;
  const options = countryOptions(stage, decisions);
  if (options.some((o) => !o.url)) return null;
  return {
    version: 1, stage, jurisdiction: request.jurisdiction, fingerprint: inputFingerprint(plan.evidence.pasted.contract.rawInput),
    options, decisions: [], plan, response: record(response), ...(pastedCitation !== undefined ? { pastedCitation } : {}),
    country: { request, decisions },
  };
}

export type ChoiceSelection =
  | { kind: "stale" }
  | { kind: "invalid" }
  | { kind: "choice"; choice: ForeignCaseChoice; reply: string }
  | { kind: "respond"; data: Record<string, unknown> };

/**
 * Prepare a user's choice. `currentInputs` are the forms of the input the
 * conversation holds NOW (e.g. raw and abbreviation-normalized); the choice is
 * accepted only if one of them still binds to the original input.
 */
export function prepareChoiceSelection(choice: ForeignCaseChoice, optionId: string, currentInputs: string[]): ChoiceSelection {
  const raw = choice.plan.evidence.pasted.contract.rawInput;
  if (choice.version !== 1 || inputFingerprint(raw) !== choice.fingerprint) return { kind: "stale" };
  if (!currentInputs.some((v) => typeof v === "string" && inputFingerprint(v) === choice.fingerprint && citationBindingText(v) === citationBindingText(raw))) return { kind: "stale" };
  if (!choice.options.some((o) => o.id === optionId)) return { kind: "invalid" };
  if (choice.country) {
    const { request, decisions } = choice.country;
    const decision = choice.stage === "decision" ? decisions.find((d) => d.id === optionId) : decisions[0];
    if (!decision) return { kind: "invalid" };
    if (choice.stage === "decision" && decision.options.length > 1) {
      const options = countryOptions("location", [decision]);
      const next: ForeignCaseChoice = { ...choice, stage: "location", options, country: { request, decisions: [decision] } };
      return { kind: "choice", choice: next, reply: locationChoiceReply(options) };
    }
    const option = choice.stage === "decision" ? decision.options[0] : decision.options.find((o) => o.id === optionId);
    if (!option) return { kind: "invalid" };
    return { kind: "respond", data: { foreignLookup: countryOptionResponse(request, option, choice.response),
      ...(choice.pastedCitation !== undefined ? { pastedCitation: choice.pastedCitation } : {}) } };
  }
  const req = choice.plan.foreignLookup!;
  const parsed = record(req.parsedFields) as Record<string, string>;
  const userYear = parsed.year ?? String(req.rawInput ?? "").match(/\b(19|20)\d{2}\b/)?.[0];
  const suppliedLocation = !!(parsed.reporter && parsed.firstPage);
  let d: CaseDecisionRecord | undefined;
  let chosenId: string | undefined;
  if (choice.stage === "decision") {
    d = choice.decisions.find((x) => x.id === optionId);
    if (!d) return { kind: "invalid" };
    const selectable = selectableLocations(d);
    if (!suppliedLocation && selectable.length > 1) {
      // The chosen ruling still has parallel reports: ask again, from the same records.
      const options = locationOptions(d);
      const next: ForeignCaseChoice = { ...choice, stage: "location", options, decisions: [d] };
      return { kind: "choice", choice: next, reply: locationChoiceReply(options) };
    }
    chosenId = !suppliedLocation && selectable.length === 1 ? selectable[0].id : undefined;
  } else {
    d = choice.decisions[0];
    if (suppliedLocation || !selectableLocations(d).some((l) => l.id === optionId)) return { kind: "invalid" };
    chosenId = optionId;
  }
  const chosen = chosenId ? d.locations.find((l) => l.id === chosenId) : undefined;
  const grounded = groundDecisionFields(d, chosen, userYear);
  const identity = record(choice.response.identity);
  const priorConflicts = Array.isArray(identity.conflicts) ? identity.conflicts.filter((c): c is string => typeof c === "string") : [];
  // Only the ambiguity the user just resolved is removed; any other conflict still stops acceptance.
  const conflicts = [...priorConflicts.filter((c) => c !== "ambiguous_record" && !c.startsWith("location:")), ...d.locationConflicts];
  const { disambiguation: _d, locationChoiceRequired: _l, ...rest } = choice.response;
  const synthesized: Record<string, unknown> = {
    ...rest,
    fields: grounded.fields, grounded: grounded.grounded, provenance: grounded.provenance,
    caseDecisions: [d],
    identity: { ...identity, matched: true, conflicts, court: grounded.fields.court ?? parsed.court, year: grounded.fields.year ?? userYear },
  };
  return { kind: "respond", data: { foreignLookup: synthesized, ...(choice.pastedCitation !== undefined ? { pastedCitation: choice.pastedCitation } : {}) } };
}
