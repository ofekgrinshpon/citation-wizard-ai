import { useId, useMemo, useState } from "react";
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
  FOREIGN_JURISDICTIONS,
  INTERNATIONAL_ENTITIES,
  US_OTHER,
  US_STATES_AND_DC,
  getEntity,
  searchEntities,
  subdivisionsOf,
  type RegistryEntity,
} from "@/data/bluebook/classification/entities";

/** Display copy for axis values (UI wording only; ids stay as supplied). */
const MEDIUM_LABELS: Record<string, string> = {
  print: "דפוס",
  web: "רשת",
  commercial_database: "מאגר מסחרי",
  electronic_storage: "אמצעי אחסון אלקטרוני",
  microform: "מיקרופורם",
};
const MANIFESTATION_LABELS: Record<string, string> = {
  authenticated: "עותק מאומת",
  official: "רשמי",
  exact_copy: "העתק מדויק",
  archived_capture: "לכידה בארכיון",
};

const US_ROOT = getEntity("T1");

interface Props {
  accountId: string | null | undefined;
  itemKey: string;
  input: string;
  output: string | null;
}

/**
 * Foreign-source classification picker. Purely local and deterministic:
 * selecting, changing, resetting or restoring never calls the network.
 * Regeneration stays the existing explicit button of the host flow.
 */
export function ForeignSourcePicker({ accountId, itemKey, input, output }: Props) {
  const c = useForeignClassification({ accountId, itemKey, input, output });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showOptionalJur, setShowOptionalJur] = useState(false);
  const baseId = useId();
  const e = c.effective;
  const fam = e.scalars.family;
  const jurId = e.scalars.jurisdiction;
  const jur = getEntity(jurId);
  const sub = getEntity(e.scalars.subjurisdiction);
  const jurExpected = !!fam && JURISDICTION_EXPECTED_FAMILIES.has(fam);
  const showJur = jurExpected || showOptionalJur || !!jurId;

  const q = query.trim().toLowerCase();
  const familyMatches = useMemo(() => FAMILIES.filter((f) =>
    !q || f.label.toLowerCase().includes(q) || subtypesOf(f.id).some((s) => s.label.toLowerCase().includes(q))), [q]);
  const jurPool: RegistryEntity[] = useMemo(() => [
    ...(US_ROOT ? [US_ROOT] : []), ...US_STATES_AND_DC, ...US_OTHER, ...FOREIGN_JURISDICTIONS, ...INTERNATIONAL_ENTITIES,
  ], []);
  const jurMatches = useMemo(() => searchEntities(query, jurPool), [query, jurPool]);
  const subs = jurId ? subdivisionsOf(jurId) : [];
  const institutionRelevant = !!fam && INSTITUTION_FAMILIES.has(fam);

  const summary = e.otherUnidentified || !fam
    ? "אחר / לא זוהה"
    : [familyLabel(fam), subtypeLabel(e.scalars.subtype), sub?.name ?? jur?.name].filter(Boolean).join(" · ");
  const manual = Object.values(e.source).includes("user_override") || e.otherUnidentified;

  return (
    <section
      dir="rtl"
      aria-label="סיווג מקור לועזי"
      className="mt-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs"
      data-testid="foreign-source-picker"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">מקור לועזי:</span>
        <strong className="text-foreground" data-testid="foreign-effective">{summary}</strong>
        <span className="text-[10px] text-muted-foreground">{manual ? "נקבע ידנית" : "זוהה אוטומטית"}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${baseId}-panel`}
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-border px-2 py-0.5 text-primary hover:bg-accent"
        >
          {open ? "סגור" : "שינוי סיווג"}
        </button>
        {manual && (
          <button type="button" onClick={c.reset} className="rounded px-2 py-0.5 text-muted-foreground hover:text-foreground">
            חזרה לזיהוי האוטומטי
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
          הסיווג השתנה, והאזכור המוצג נוצר לפני השינוי. להפקה מחדש יש להשתמש בכפתור ההפקה הקיים.
        </p>
      )}

      {open && (
        <div id={`${baseId}-panel`} className="mt-2 space-y-2.5 border-t border-border pt-2">
          <label className="block">
            <span className="sr-only">חיפוש סוג מקור או תחום שיפוט</span>
            <input
              type="search"
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="חיפוש סוג מקור או תחום שיפוט"
              className="w-full rounded border border-input bg-background px-2 py-1"
            />
          </label>

          <fieldset>
            <legend className="mb-1 font-medium">סוג המקור</legend>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              <button
                type="button"
                aria-pressed={e.otherUnidentified}
                onClick={() => c.setOverride({ otherUnidentified: true })}
                className="block w-full rounded px-2 py-1 text-right hover:bg-accent aria-pressed:bg-primary/10"
              >
                אחר / לא זוהה
              </button>
              {familyMatches.map((f) => (
                <div key={f.id}>
                  <button
                    type="button"
                    aria-pressed={fam === f.id && !e.otherUnidentified}
                    onClick={() => c.setOverride({ scalars: { family: f.id } })}
                    className="block w-full rounded px-2 py-1 text-right font-medium hover:bg-accent aria-pressed:bg-primary/10"
                  >
                    {f.label}
                  </button>
                  {fam === f.id && (
                    <div role="group" aria-label={`תתי־סוגים: ${f.label}`} className="mr-3 space-y-0.5">
                      {subtypesOf(f.id).filter((s) => !q || s.label.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          aria-pressed={e.scalars.subtype === s.id}
                          onClick={() => c.setOverride({ scalars: { subtype: s.id } })}
                          className="block w-full rounded px-2 py-0.5 text-right hover:bg-accent aria-pressed:bg-primary/10"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1 font-medium">אמצעי גישה</legend>
            <div className="flex flex-wrap gap-3">
              {(getAxis("access_medium")?.values ?? []).map((v) => {
                const cur = e.multi.access_medium ?? [];
                return (
                  <label key={v} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={cur.includes(v)}
                      onChange={(ev) => c.setOverride({ multi: { access_medium: ev.target.checked ? [...cur, v] : cur.filter((x) => x !== v) } })}
                    />
                    {MEDIUM_LABELS[v] ?? v}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1 font-medium">מאפייני העותק המקוון</legend>
            <div className="flex flex-wrap gap-3">
              {(getAxis("manifestation_flags")?.values ?? []).map((v) => {
                const cur = e.flags.manifestation_flags ?? {};
                return (
                  <label key={v} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!cur[v]}
                      onChange={(ev) => c.setOverride({ flags: { manifestation_flags: { ...cur, [v]: ev.target.checked } } })}
                    />
                    {MANIFESTATION_LABELS[v] ?? v}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {!showJur && (
            <button type="button" onClick={() => setShowOptionalJur(true)} className="text-primary underline-offset-2 hover:underline">
              הוספת תחום שיפוט (לא חובה לסוג מקור זה)
            </button>
          )}
          {showJur && (
            <div className="space-y-1.5">
              <label className="block">
                <span className="mb-0.5 block font-medium">תחום שיפוט או גוף מנפיק{jurExpected ? "" : " (לא חובה)"}</span>
                <select
                  value={jurId ?? ""}
                  onChange={(ev) => c.setOverride({ scalars: { jurisdiction: ev.target.value || null } })}
                  className="w-full rounded border border-input bg-background px-2 py-1"
                >
                  <option value="">לא נקבע</option>
                  {jurMatches.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </label>
              {subs.length > 0 && (
                <label className="block">
                  <span className="mb-0.5 block font-medium">יחידת משנה</span>
                  <select
                    value={e.scalars.subjurisdiction ?? ""}
                    onChange={(ev) => c.setOverride({ scalars: { subjurisdiction: ev.target.value || null } })}
                    className="w-full rounded border border-input bg-background px-2 py-1"
                  >
                    <option value="">לא נקבע</option>
                    {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          {institutionRelevant && (
            <label className="block">
              <span className="mb-0.5 block font-medium">מוסד בין־לאומי</span>
              <select
                value={e.scalars.institution_profile ?? ""}
                onChange={(ev) => c.setOverride({ scalars: { institution_profile: ev.target.value || null } })}
                className="w-full rounded border border-input bg-background px-2 py-1"
              >
                <option value="">לא רלוונטי / לא נקבע</option>
                {INSTITUTION_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
    </section>
  );
}
