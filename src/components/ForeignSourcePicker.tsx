import { useEffect, useId, useMemo, useState } from "react";
import { useForeignClassification } from "@/hooks/useForeignClassification";
import {
  FAMILIES,
  INSTITUTION_FAMILIES,
  INSTITUTION_PROFILES,
  JURISDICTION_EXPECTED_FAMILIES,
  getAxis,
  familyLabel,
  subtypeLabel,
  subtypesOf,
} from "@/data/bluebook/classification/taxonomy";
import {
  FOREIGN_JURISDICTIONS_ED21,
  FOREIGN_JURISDICTIONS_ED22_ONLY,
  INTERNATIONAL_ENTITIES,
  US_OTHER,
  US_ROOT_ID,
  US_STATES_AND_DC,
  getEntity,
  searchEntities,
  subdivisionGroupsOf,
  subdivisionsOf,
  type RegistryEntity,
} from "@/data/bluebook/classification/entities";
import {
  STRUCTURED_FIELD_KIND,
  type ClassificationRecord,
  type EffectiveClassification,
  type FlagField,
  type GenerationPlan,
  type MultiField,
  type StructuredAxis,
  type StructuredValue,
} from "@/lib/foreignClassification";

/** Display copy only; stored values stay the workbook ids. */
const VALUE_LABELS: Record<string, string> = {
  print: "דפוס", web: "רשת", commercial_database: "מאגר מסחרי", electronic_storage: "אמצעי אחסון אלקטרוני", microform: "מיקרופורם",
  authenticated: "עותק מאומת", official: "רשמי", exact_copy: "העתק מדויק", archived_capture: "לכידה בארכיון",
  published: "פורסם", unpublished: "לא פורסם", forthcoming: "עתיד להתפרסם", withdrawn_or_depublished: "נמשך או הוסר מפרסום", unknown: "לא ידוע",
  pending: "תלוי ועומד", decided: "הוכרע",
  reporter_locator: "סדרת דיווח", neutral_citation: "אזכור ניטרלי", document_number: "מספר מסמך", paragraph_number: "מספר פסקה", other: "אחר",
  book_collection: "קובץ", journal: "כתב עת", newspaper: "עיתון", reporter: "סדרת דיווח", service: "שירות", looseleaf: "דפדפת", repository: "מאגר",
  multi_volume: "רב־כרכי", reprint: "הדפסה חוזרת", supplement: "מוסף", pre_1900: "לפני 1900",
};
const FIELD_LABELS: Record<string, string> = {
  author_list: "מחברים (שורה לכל אחד)", institutional_author: "מחבר מוסדי", editor_list: "עורכים (שורה לכל אחד)", translator_list: "מתרגמים (שורה לכל אחד)",
  student_author: "מחבר תלמיד", signed: "חתום",
  party_list: "צדדים (שורה לכל צד)", bilateral_or_multilateral: "דו־צדדית או רב־צדדית", us_is_party: "ארצות הברית צד",
  source_language: "שפת המקור", source_script: "כתב המקור", translation_language: "שפת התרגום", transliteration: "תעתיק", original_title: "כותרת מקורית",
  issuer_id: "גוף מנפיק",
  reproduction_form: "צורת העותק", repository: "מקום שמירה", archive_url: "כתובת בארכיון", capture_date: "תאריך לכידה",
};
const AXIS_LABELS: Record<string, string> = {
  authorship: "פרטי היוצר", treaty_parties: "צדדים לאמנה", language_script: "שפה וכתב", reproduction_archive: "עותק ומיקום ארכיוני",
};

const LITERATURE = new Set(["nonperiodical", "collection_component", "periodical", "unpublished_communication", "web_native", "audiovisual"]);
const CITATION_SCHEME_FAMILIES = new Set(["decision", "proceeding_document", "constitution", "normative_instrument", "legislative_material", "administrative_material", "treaty", "institutional_record"]);
const COURT_FAMILIES = new Set(["decision", "proceeding_document"]);

/** Which axis controls are shown for a family (all shown with "show all"). */
export function visibleAxes(family: string | undefined, all: boolean): Set<string> {
  const s = new Set(["access_medium", "manifestation_flags", "publication_status", "container", "language_script", "reproduction_archive", "issuer_jurisdiction"]);
  if (all || (family && COURT_FAMILIES.has(family))) s.add("proceeding_status");
  if (all || (family && CITATION_SCHEME_FAMILIES.has(family))) s.add("citation_scheme");
  if (all || family === "nonperiodical" || family === "collection_component") s.add("edition_flags");
  if (all || (family && LITERATURE.has(family))) s.add("authorship");
  if (all || family === "treaty") s.add("treaty_parties");
  return s;
}

export interface ForeignClassificationSnapshot {
  record: ClassificationRecord;
  effective: EffectiveClassification;
  plan: GenerationPlan | null;
}

interface Props {
  accountId: string | null | undefined;
  itemKey: string;
  input: string;
  /** Explicit, separate generation using the effective choice (host's existing operation). */
  onRegenerate?: (plan: GenerationPlan) => void;
  onChange?: (snapshot: ForeignClassificationSnapshot) => void;
  regenerateDisabled?: boolean;
}

/**
 * Foreign-source classification picker. Selecting, changing, resetting and
 * restoring are local and deterministic — never a network call. Generation
 * happens only through the host's explicit action.
 */
export function ForeignSourcePicker({ accountId, itemKey, input, onRegenerate, onChange, regenerateDisabled }: Props) {
  const c = useForeignClassification({ accountId, itemKey, input });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showOptionalJur, setShowOptionalJur] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const baseId = useId();
  const e = c.effective;
  const fam = e.scalars.family;
  const jurId = e.scalars.jurisdiction;
  const jur = getEntity(jurId);
  const sub = getEntity(e.scalars.subjurisdiction);
  const jurExpected = !!fam && JURISDICTION_EXPECTED_FAMILIES.has(fam);
  const showJur = jurExpected || showOptionalJur || !!jurId || showAll;
  const axes = visibleAxes(fam, showAll);

  useEffect(() => { onChange?.({ record: c.record, effective: e, plan: c.plan }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.record]);

  const q = query.trim().toLowerCase();
  const familyMatches = useMemo(() => FAMILIES.filter((f) =>
    !q || f.label.toLowerCase().includes(q) || subtypesOf(f.id).some((s) => s.label.toLowerCase().includes(q))), [q]);
  const groups: [string, RegistryEntity[]][] = useMemo(() => {
    const us = getEntity(US_ROOT_ID);
    return ([
      ["ארצות הברית", [...(us ? [us] : []), ...US_STATES_AND_DC, ...US_OTHER]],
      ["תחומי שיפוט זרים", FOREIGN_JURISDICTIONS_ED21],
      ["רשומות נוספות (מהדורה 22, לא אומתו למהדורה 21)", FOREIGN_JURISDICTIONS_ED22_ONLY],
      ["מוסדות בין־לאומיים", INTERNATIONAL_ENTITIES],
    ] as [string, RegistryEntity[]][]).map(([l, pool]) => [l, searchEntities(query, pool)] as [string, RegistryEntity[]]).filter(([, p]) => p.length);
  }, [query]);
  const subs = jurId ? subdivisionsOf(jurId) : [];
  const groupsHint = jurId ? subdivisionGroupsOf(jurId) : [];

  const summary = e.otherUnidentified || !fam
    ? "אחר / לא זוהה"
    : [familyLabel(fam), subtypeLabel(e.scalars.subtype), sub?.name ?? jur?.name].filter(Boolean).join(" · ");
  const manual = Object.values(e.source).includes("user_override") || e.otherUnidentified;

  const multiControl = (k: MultiField, legend: string) => axes.has(k) && (
    <fieldset>
      <legend className="mb-1 font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {(getAxis(k)?.values ?? []).map((v) => {
          const cur = e.multi[k] ?? [];
          return (
            <label key={v} className="flex items-center gap-1">
              <input type="checkbox" checked={cur.includes(v)}
                onChange={(ev) => c.setOverride({ multi: { [k]: ev.target.checked ? [...cur, v] : cur.filter((x) => x !== v) } })} />
              {VALUE_LABELS[v] ?? v}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
  const flagControl = (k: FlagField, legend: string) => axes.has(k) && (
    <fieldset>
      <legend className="mb-1 font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {(getAxis(k)?.values ?? []).map((v) => {
          const cur = e.flags[k] ?? {};
          return (
            <label key={v} className="flex items-center gap-1">
              <input type="checkbox" checked={!!cur[v]} onChange={(ev) => c.setOverride({ flags: { [k]: { ...cur, [v]: ev.target.checked } } })} />
              {VALUE_LABELS[v] ?? v}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
  const singleControl = (k: "publication_status" | "proceeding_status", label: string) => axes.has(k) && (
    <label className="block">
      <span className="mb-0.5 block font-medium">{label}</span>
      <select value={e.scalars[k] ?? ""} onChange={(ev) => c.setOverride({ scalars: { [k]: ev.target.value || null } })}
        className="w-full rounded border border-input bg-background px-2 py-1">
        <option value="">לא צוין</option>
        {(getAxis(k)?.values ?? []).map((v) => <option key={v} value={v}>{VALUE_LABELS[v] ?? v}</option>)}
      </select>
    </label>
  );
  const setField = (axis: StructuredAxis, f: string, v: StructuredValue) => c.setOverride({ structured: { [axis]: { [f]: v } } });
  const structuredControl = (axis: Exclude<StructuredAxis, "issuer_jurisdiction">) => axes.has(axis) && (
    <fieldset>
      <legend className="mb-1 font-medium">{AXIS_LABELS[axis]}</legend>
      <div className="grid gap-1.5">
        {Object.entries(STRUCTURED_FIELD_KIND[axis]).map(([f, kind]) => {
          const v = e.structured[axis]?.[f] ?? null;
          const label = FIELD_LABELS[f] ?? f;
          if (kind === "boolean") return (
            <label key={f} className="flex items-center gap-2">
              <span className="min-w-28">{label}</span>
              <select aria-label={label} value={v === null ? "" : v ? "yes" : "no"}
                onChange={(ev) => setField(axis, f, ev.target.value === "" ? null : ev.target.value === "yes")}
                className="rounded border border-input bg-background px-1 py-0.5">
                <option value="">לא צוין</option><option value="yes">כן</option><option value="no">לא</option>
              </select>
            </label>
          );
          if (kind === "list") return (
            <label key={f} className="block">
              <span className="block">{label}</span>
              <textarea aria-label={label} rows={2} value={Array.isArray(v) ? v.join("\n") : ""}
                onChange={(ev) => setField(axis, f, ev.target.value === "" ? null : ev.target.value.split("\n"))}
                className="w-full rounded border border-input bg-background px-2 py-1" dir="auto" />
            </label>
          );
          return (
            <label key={f} className="block">
              <span className="block">{label}</span>
              <input aria-label={label} type="text" value={typeof v === "string" ? v : ""}
                onChange={(ev) => setField(axis, f, ev.target.value === "" ? null : ev.target.value)}
                className="w-full rounded border border-input bg-background px-2 py-1" dir="auto" />
            </label>
          );
        })}
      </div>
    </fieldset>
  );

  return (
    <section dir="rtl" aria-label="סיווג מקור לועזי" data-testid="foreign-source-picker"
      className="mt-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">מקור לועזי:</span>
        <strong className="text-foreground" data-testid="foreign-effective">{summary}</strong>
        <span className="text-[10px] text-muted-foreground">{manual ? "נקבע ידנית" : "זוהה אוטומטית"}</span>
        <button type="button" aria-expanded={open} aria-controls={`${baseId}-panel`} onClick={() => setOpen((v) => !v)}
          className="rounded border border-border px-2 py-0.5 text-primary hover:bg-accent">
          {open ? "סגור" : "שינוי סיווג"}
        </button>
        {manual && (
          <button type="button" onClick={c.reset} className="rounded px-2 py-0.5 text-muted-foreground hover:text-foreground">
            חזרה לזיהוי האוטומטי
          </button>
        )}
        {onRegenerate && c.plan && (
          <button type="button" disabled={regenerateDisabled} onClick={() => c.plan && onRegenerate(c.plan)}
            className="rounded border border-primary px-2 py-0.5 text-primary disabled:opacity-40">
            הפקה מחדש לפי הסיווג
          </button>
        )}
      </div>

      <p role="status" className="mt-1 text-[11px] text-muted-foreground" data-testid="foreign-support" data-status={c.support.status}>
        {c.support.message}
      </p>

      {c.record.needsReview && (
        <div role="alert" className="mt-1.5 rounded border border-border bg-background px-2 py-1.5" data-testid="foreign-needs-review">
          <p>הקלט השתנה מאז שנקבע הסיווג הידני. יש לבדוק שהסיווג עדיין מתאים.</p>
          <div className="mt-1 flex gap-2">
            <button type="button" onClick={c.keep} className="rounded border border-border px-2 py-0.5">השאר את הבחירה</button>
            <button type="button" onClick={c.reset} className="rounded border border-border px-2 py-0.5">אפס לזיהוי האוטומטי</button>
          </div>
        </div>
      )}

      {c.stale && (
        <p role="status" className="mt-1 text-[11px] text-foreground" data-testid="foreign-stale">
          האזכור המוצג לא הופק לפי הסיווג והקלט הנוכחיים. להפקה מחדש יש להשתמש בפעולת ההפקה.
        </p>
      )}

      {open && (
        <div id={`${baseId}-panel`} className="mt-2 space-y-2.5 border-t border-border pt-2">
          <label className="block">
            <span className="sr-only">חיפוש סוג מקור או תחום שיפוט</span>
            <input type="search" value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="חיפוש סוג מקור או תחום שיפוט"
              className="w-full rounded border border-input bg-background px-2 py-1" />
          </label>

          <fieldset>
            <legend className="mb-1 font-medium">סוג המקור</legend>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              <button type="button" aria-pressed={e.otherUnidentified} onClick={() => c.setOverride({ otherUnidentified: true })}
                className="block w-full rounded px-2 py-1 text-right hover:bg-accent aria-pressed:bg-primary/10">
                אחר / לא זוהה
              </button>
              {familyMatches.map((f) => (
                <div key={f.id}>
                  <button type="button" aria-pressed={fam === f.id && !e.otherUnidentified} onClick={() => c.setOverride({ scalars: { family: f.id } })}
                    className="block w-full rounded px-2 py-1 text-right font-medium hover:bg-accent aria-pressed:bg-primary/10">
                    {f.label}
                  </button>
                  {fam === f.id && (
                    <div role="group" aria-label={`תתי־סוגים: ${f.label}`} className="mr-3 space-y-0.5">
                      {subtypesOf(f.id).filter((s) => !q || s.label.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)).map((s) => (
                        <button key={s.id} type="button" aria-pressed={e.scalars.subtype === s.id} onClick={() => c.setOverride({ scalars: { subtype: s.id } })}
                          className="block w-full rounded px-2 py-0.5 text-right hover:bg-accent aria-pressed:bg-primary/10">
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </fieldset>

          {multiControl("access_medium", "אמצעי גישה")}
          {flagControl("manifestation_flags", "מאפייני העותק המקוון")}
          {singleControl("publication_status", "מצב פרסום")}
          {singleControl("proceeding_status", "מצב ההליך")}
          {multiControl("citation_scheme", "שיטת אזכור")}
          {multiControl("container", "מסגרת הפרסום")}
          {flagControl("edition_flags", "מאפייני מהדורה וכרך")}
          {structuredControl("authorship")}
          {structuredControl("treaty_parties")}

          {!showJur && (
            <button type="button" onClick={() => setShowOptionalJur(true)} className="text-primary underline-offset-2 hover:underline">
              הוספת תחום שיפוט (לא חובה לסוג מקור זה)
            </button>
          )}
          {showJur && (
            <fieldset className="space-y-1.5">
              <legend className="mb-0.5 font-medium">גוף מנפיק ותחום שיפוט</legend>
              <label className="block">
                <span className="mb-0.5 block">תחום שיפוט{jurExpected ? "" : " (לא חובה)"}</span>
                <select value={jurId ?? ""} onChange={(ev) => c.setOverride({ scalars: { jurisdiction: ev.target.value || null } })}
                  className="w-full rounded border border-input bg-background px-2 py-1">
                  <option value="">לא נקבע</option>
                  {groups.map(([label, pool]) => (
                    <optgroup key={label} label={label}>
                      {pool.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              {subs.length > 0 && (
                <label className="block">
                  <span className="mb-0.5 block">יחידת משנה</span>
                  <select value={e.scalars.subjurisdiction ?? ""} onChange={(ev) => c.setOverride({ scalars: { subjurisdiction: ev.target.value || null } })}
                    className="w-full rounded border border-input bg-background px-2 py-1">
                    <option value="">לא נקבע</option>
                    {subs.map((s) => <option key={s.id} value={s.id}>{s.name}{s.locators.ed21 ? "" : " (רשומת מהדורה 22)"}</option>)}
                  </select>
                </label>
              )}
              {groupsHint.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {groupsHint.map((g) => g.name).join(", ")}: קבוצת יחידות משנה ללא רשימה מפורטת; ניתן לציין בשדה הגוף המנפיק.
                </p>
              )}
              {(showAll || (fam && COURT_FAMILIES.has(fam))) && (
                <label className="block">
                  <span className="mb-0.5 block">ערכאה או מוסד בין־לאומי</span>
                  <select value={e.scalars.court ?? ""} onChange={(ev) => c.setOverride({ scalars: { court: ev.target.value || null } })}
                    className="w-full rounded border border-input bg-background px-2 py-1">
                    <option value="">לא נקבע</option>
                    {INTERNATIONAL_ENTITIES.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="mb-0.5 block">{FIELD_LABELS.issuer_id}</span>
                <input type="text" aria-label={FIELD_LABELS.issuer_id} dir="auto"
                  value={typeof e.structured.issuer_jurisdiction?.issuer_id === "string" ? (e.structured.issuer_jurisdiction.issuer_id as string) : ""}
                  onChange={(ev) => setField("issuer_jurisdiction", "issuer_id", ev.target.value || null)}
                  className="w-full rounded border border-input bg-background px-2 py-1" />
              </label>
            </fieldset>
          )}

          {(showAll || (fam && INSTITUTION_FAMILIES.has(fam))) && (
            <label className="block">
              <span className="mb-0.5 block font-medium">קבוצת מוסדות (פרופיל)</span>
              <select value={e.scalars.institution_profile ?? ""} onChange={(ev) => c.setOverride({ scalars: { institution_profile: ev.target.value || null } })}
                className="w-full rounded border border-input bg-background px-2 py-1">
                <option value="">לא רלוונטי / לא נקבע</option>
                {INSTITUTION_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          )}

          {structuredControl("language_script")}
          {structuredControl("reproduction_archive")}

          <button type="button" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)} className="text-primary hover:underline">
            {showAll ? "הצג רק שדות רלוונטיים" : "הצג את כל השדות"}
          </button>
        </div>
      )}
    </section>
  );
}
