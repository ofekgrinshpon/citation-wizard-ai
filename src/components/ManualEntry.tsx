import { useState, useCallback } from "react";
import { LawAutocomplete } from "./LawAutocomplete";
import { type LawEntry } from "@/data/laws";
import {
  type SourceType,
  REQUIRED_FIELDS,
  FIELD_LABELS,
  SOURCE_TYPE_LABELS,
  RULE_REFERENCES,
} from "@/data/abbreviations";
import { invokeFunction } from "@/lib/functionError";
import { FormattedCitation } from "./FormattedCitation";
import { toast } from "sonner";

const SOURCE_TYPES: { id: SourceType; label: string; icon: string }[] = [
  { id: "case_law_published", label: "פסיקה (דפוס)", icon: "⚖️" },
  { id: "case_law_database", label: "פסיקה (מאגר)", icon: "💾" },
  { id: "primary_legislation", label: "חקיקה ראשית", icon: "📜" },
  { id: "basic_law", label: "חוק יסוד", icon: "🏛" },
  { id: "secondary_legislation", label: "חקיקת משנה", icon: "📋" },
  { id: "book", label: "ספר", icon: "📚" },
  { id: "article", label: "מאמר", icon: "📰" },
  { id: "internet", label: "מקור מרשתת", icon: "🌐" },
  { id: "foreign", label: "מקור לועזי", icon: "🌍" },
];

export function ManualEntry() {
  const [sourceType, setSourceType] = useState<SourceType | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<string | null>(null);
  const [ruleRef, setRuleRef] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [missingFields, setMissingFields] = useState<string[]>([]);

  const updateField = useCallback((key: string, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    // Clear missing field highlight when user fills it
    setMissingFields((prev) => prev.filter((f) => f !== key));
  }, []);

  const handleLawSelect = useCallback((law: LawEntry) => {
    setFields((prev) => ({
      ...prev,
      lawName: law.name,
      hebrewYear: law.hebrewYear,
      gregorianYear: law.gregorianYear ? String(law.gregorianYear) : "",
      collection: law.collection,
      firstPage: law.page ? String(law.page) : "",
    }));

    if (law.isBasicLaw) {
      setSourceType("basic_law");
    }

    // Smart message for Basic Laws (Rule 4.3 / 2.7)
    if (law.isBasicLaw) {
      toast.info(
        `נבחר ${law.name}. לפי כלל 4.3, יש לציין את שנת הקובץ. אנא ודא שהשנה מלאה.`,
        { duration: 5000 }
      );
    }

    // New version / combined version rules 4.5 / 4.6
    if (law.isNewVersion || law.isCombinedVersion) {
      const versionLabel = law.isCombinedVersion ? "[נוסח משולב]" : "[נוסח חדש]";
      toast.info(
        `${law.name} הוא ב${versionLabel}. זה יתווסף אוטומטית לאזכור לפי כלל ${law.isCombinedVersion ? "4.6" : "4.5"}.`,
        { duration: 5000 }
      );
    }
  }, []);

  const getFieldsForType = (type: SourceType): string[] => {
    const required = REQUIRED_FIELDS[type] || [];
    // Add optional fields
    const optional: string[] = [];
    if (type === "case_law_published" || type === "case_law_database") {
      optional.push("specificPage", "paragraph", "court", "district");
    }
    if (type === "primary_legislation" || type === "basic_law") {
      optional.push("section");
    }
    if (type === "book") {
      optional.push("edition", "specificPage");
    }
    if (type === "article") {
      optional.push("specificPage");
    }
    return [...required, ...optional.filter((f) => !required.includes(f))];
  };

  const validateAndGenerate = async () => {
    if (!sourceType) return;

    const required = REQUIRED_FIELDS[sourceType];
    const missing = required.filter((f) => !fields[f]?.trim());

    if (missing.length > 0) {
      setMissingFields(missing);
      const missingLabels = missing.map((f) => FIELD_LABELS[f] || f).join(", ");
      toast.error(`חסרים פרטים לסוג מקור "${SOURCE_TYPE_LABELS[sourceType]}": ${missingLabels}`, {
        duration: 6000,
      });
      return;
    }

    setLoading(true);
    setMissingFields([]);

    try {
      const prompt = buildPromptFromFields(sourceType, fields);
      const { data, errorInfo } = await invokeFunction<{ content?: string }>("citation-chat", {
        messages: [{ role: "user", content: prompt }],
      });

      if (errorInfo) {
        toast.error(errorInfo.message);
        return;
      }
      setOutput(data?.content || "שגיאה בייצור האזכור");
      setRuleRef(RULE_REFERENCES[sourceType]);
    } finally {
      setLoading(false);
    }
  };


  const copyToClipboard = () => {
    if (!output) return;
    // Extract only the citation: remove rule/meta lines (📐, כלל:, etc.) and blank lines
    const citationOnly = output
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (/^📐|^כלל:|^Based on Rule|^Rule \d|^מכיוון ש/.test(trimmed)) return false;
        return true;
      })
      .join("\n")
      .replace(/\*\*/g, "")
      .replace(/##/g, "");
    navigator.clipboard.writeText(citationOnly);
    toast.success("האזכור הועתק ללוח!");
  };

  const resetForm = () => {
    setSourceType(null);
    setFields({});
    setOutput(null);
    setRuleRef("");
    setMissingFields([]);
  };

  return (
    <div className="py-6" style={{ direction: "rtl" }}>
      {/* Source type selection */}
      {!sourceType ? (
        <div>
          <h3 className="text-foreground text-lg font-bold mb-4 font-sans">
            בחר סוג מקור
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {SOURCE_TYPES.map((st) => (
              <button
                key={st.id}
                onClick={() => setSourceType(st.id)}
                className="feature-card hover:border-primary/40 transition-all cursor-pointer group"
              >
                <div className="text-2xl mb-2 group-hover:scale-110 transition-transform">
                  {st.icon}
                </div>
                <div className="text-foreground text-sm font-semibold">
                  {st.label}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          {/* Header with back button */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={resetForm}
                className="text-muted-foreground hover:text-foreground transition-colors text-sm"
              >
                ← חזור
              </button>
              <h3 className="font-sans text-foreground text-lg font-bold">
                {SOURCE_TYPE_LABELS[sourceType]}
              </h3>
            </div>
            {ruleRef && (
              <span className="citation-badge bg-primary/20 text-primary">
                {ruleRef}
              </span>
            )}
          </div>

          {/* Dynamic form fields */}
          <div className="space-y-3">
            {getFieldsForType(sourceType).map((fieldKey) => {
              const isRequired = REQUIRED_FIELDS[sourceType]?.includes(fieldKey);
              const isMissing = missingFields.includes(fieldKey);
              const label = FIELD_LABELS[fieldKey] || fieldKey;

              // Special autocomplete for law name
              if (
                fieldKey === "lawName" &&
                (sourceType === "primary_legislation" || sourceType === "basic_law")
              ) {
                return (
                  <div key={fieldKey}>
                    <label className="block text-sm text-muted-foreground mb-1">
                      {label}
                      {isRequired && <span className="text-destructive mr-1">*</span>}
                    </label>
                    <LawAutocomplete
                      value={fields.lawName || ""}
                      onChange={(v) => updateField("lawName", v)}
                      onSelect={handleLawSelect}
                      placeholder="הקלד שם חוק..."
                    />
                  </div>
                );
              }

              return (
                <div key={fieldKey}>
                  <label className="block text-sm text-muted-foreground mb-1">
                    {label}
                    {isRequired && <span className="text-destructive mr-1">*</span>}
                  </label>
                  <input
                    type="text"
                    value={fields[fieldKey] || ""}
                    onChange={(e) => updateField(fieldKey, e.target.value)}
                    className={`w-full bg-surface border rounded-lg px-3 py-2.5 text-foreground text-sm font-sans transition-colors ${
                      isMissing
                        ? "border-destructive/60 bg-destructive/5"
                        : "border-border focus:border-primary/50"
                    }`}
                    style={{ direction: fieldKey === "url" ? "ltr" : "rtl" }}
                    placeholder={
                      fieldKey === "caseType"
                        ? 'למשל: בג"ץ, ע"א, ת"א'
                        : fieldKey === "caseNumber"
                        ? "למשל: 73/53"
                        : fieldKey === "hebrewYear"
                        ? 'למשל: התשל"ז'
                        : ""
                    }
                  />
                </div>
              );
            })}
          </div>

          {/* Missing fields alert */}
          {missingFields.length > 0 && (
            <div className="mt-4 bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-foreground">
              ⚠️ חסרים פרטים לפי {RULE_REFERENCES[sourceType] || "הכללים"}.
              אנא מלא את השדות המסומנים.
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={validateAndGenerate}
            disabled={loading}
            className="mt-4 w-full py-3 rounded-lg font-semibold text-sm transition-all disabled:opacity-40"
            style={{
              background: loading ? "hsl(var(--surface))" : "var(--gradient-primary)",
              color: loading ? "hsl(var(--muted-foreground))" : "hsl(var(--primary-foreground))",
            }}
          >
            {loading ? "מייצר אזכור..." : "⚖ ייצר אזכור תקני"}
          </button>

          {/* Output preview */}
          {output && (
            <div className="mt-5 bg-card border border-border rounded-xl p-4 shadow-sm animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-foreground">
                  תוצאה:
                </h4>
                <div className="flex items-center gap-2">
                  {ruleRef && (
                    <span className="citation-badge bg-secondary/30 text-secondary-foreground text-[10px]">
                      {ruleRef}
                    </span>
                  )}
                  <button
                    onClick={copyToClipboard}
                    className="text-xs bg-primary/20 text-primary hover:bg-primary/30 px-3 py-1.5 rounded-md transition-colors font-medium"
                  >
                    📋 העתק
                  </button>
                </div>
              </div>
              <div className="text-foreground text-sm leading-relaxed bg-background/50 rounded-lg p-3 border border-border/50">
                <FormattedCitation text={output} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function buildPromptFromFields(type: SourceType, fields: Record<string, string>): string {
  const fieldStr = Object.entries(fields)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `${FIELD_LABELS[k] || k}: ${v}`)
    .join("\n");

  return `אנא ייצר אזכור תקני לפי כללי האזכור האחיד עבור ${SOURCE_TYPE_LABELS[type]}.

הפרטים שסופקו:
${fieldStr}

הנחיות קשיחות:
1. כללי האזכור האחיד גוברים על כל קלט – אם פרט שסופק סותר את הכללים, תקן אותו.
2. אם חסר פרט חובה שלא סופק (למשל שנה עברית, ס"ח, עמוד ראשון) – סמן [חסר: תיאור] במיקום המתאים.
3. אל תמציא שום מטא-נתון – עמודים, כרכים, שנים, מספרי תיקים.
4. עמוד ליד ס"ח/ק"ת חייב להיות העמוד הפותח של החוק בלבד. אם המשתמש ציין עמוד שגוי, תקן והסבר: "⚠️ לפי כלל 18.2.3, העמוד הפותח של חוק זה הוא [X] ולא [Y]."
5. לעולם אל תשרשר שני עמודים (למשל "ס"ח 247 69" – שגוי). רק עמוד אחד.
6. אם המשתמש סיפק פרגמנט בלבד (כמו "ס"ח 69" ללא שם חוק) – בקש ממנו את שם החוק המלא.
7. ייצר את האזכור בפורמט הנכון בלבד. ציין את מספר הכלל הרלוונטי בסוף.`;
}
