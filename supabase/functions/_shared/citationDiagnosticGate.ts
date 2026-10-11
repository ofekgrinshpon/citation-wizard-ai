/** Temporary, content-free observer activation. Remove after the approved experiment. */
export const CITATION_DIAGNOSTIC_FIXTURE = "Warren & Brandeis, The Right to Privacy, pp. 213–214.";
export const CITATION_DIAGNOSTIC_BUILD = "english-observer-20261011-v1";
export const CITATION_DIAGNOSTIC_PARSER = "3870af7559f0f189b92eea40daf76fcdb2184c3c3e91577020d8ecf0b764b3a1";
export const CITATION_DIAGNOSTIC_EXPIRES = Date.parse("2026-10-12T12:00:00Z");
export const CITATION_DIAGNOSTIC_QUERY = "relexCitationTrace";
const STARTS = Date.parse("2026-10-11T00:00:00Z");

export function citationDiagnosticTag(value: unknown, now = Date.now()): string | null {
  return now >= STARTS && now < CITATION_DIAGNOSTIC_EXPIRES && typeof value === "string" &&
    /^relex-en-20261011-[a-f0-9]{16}$/.test(value) ? value : null;
}

export function isCitationDiagnosticPreflight(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).preflight === true;
}

export function citationDiagnosticRequestTag(request: unknown, lookup: unknown, now = Date.now()): string | null {
  if (!request || typeof request !== "object" || Array.isArray(request) ||
      !lookup || typeof lookup !== "object" || Array.isArray(lookup)) return null;
  const tag = citationDiagnosticTag((request as Record<string, unknown>).tag, now);
  const body = lookup as Record<string, unknown>;
  if (!tag || body.enabled !== true || body.kind !== "journal_article" || body.jurisdiction !== "OTHER" ||
      body.articleResponseVersion !== 1 || body.rawInput !== CITATION_DIAGNOSTIC_FIXTURE) return null;
  const fields = body.parsedFields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const expected: Record<string, string> = { authors: "Warren & Brandeis", articleTitle: "The Right to Privacy", pinpoint: "213–214" };
  return Object.keys(fields).length === 3 && Object.entries(expected).every(([key, value]) =>
    (fields as Record<string, unknown>)[key] === value) ? tag : null;
}

/** One bounded current-role read, only after exact fixture/tag validation. No grants or writes. */
export async function authorizeCitationDiagnostic(
  request: unknown, lookup: unknown, checkAdmin: (signal: AbortSignal) => Promise<boolean>, now = Date.now(),
): Promise<string | null> {
  const tag = citationDiagnosticRequestTag(request, lookup, now);
  if (!tag) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expired = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(false); }, 1500);
    });
    const allowed = await Promise.race([Promise.resolve().then(() => checkAdmin(controller.signal)), expired]);
    return allowed === true ? tag : null;
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
