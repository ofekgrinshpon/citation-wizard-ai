/**
 * Word review: choices between results that carry no validated record
 * (Israeli party-name lists, foreign rulings found in several countries).
 * Pure, no IO. Choosing an option never formats anything by itself: the host
 * sends ONE new, user-initiated check for it (the same as the chat does).
 */
import { citationTextOnly } from "@/lib/citationSegments";

export interface ResultOption { label: string; selection: string }
export interface CountryOption { label: string; url: string }
export type RetryChoice =
  | { kind: "israeli"; options: ResultOption[] }
  | { kind: "country"; countries: { country: "us" | "uk"; options: CountryOption[] }[] };

const NUMBERED = /^\s*(\d{1,2})\.\s+(\S.*)$/;
const BLOB = /<!--DATA:[^>]*?-->/g;
const MAX_OPTIONS = 5;

/** Numbered option lines of an engine reply that asks the user to pick one result. */
export function parseResultOptions(reply: string): ResultOption[] | null {
  const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
  const numbered = lines.filter((l) => NUMBERED.test(l) && /[\u05D0-\u05EA]/.test(l));
  if (numbered.length < 2) return null;
  const asks = /<!--DATA:/.test(reply) || /התכוונת|נמצאו (?:מספר|כמה)|בחר/.test(reply);
  if (!asks) return null;
  const options = numbered.slice(0, MAX_OPTIONS).map((line) => {
    const text = line.replace(NUMBERED, "$2");
    const blobs = (text.match(BLOB) ?? []).join("");
    const display = citationTextOnly(text.replace(BLOB, "")).trim();
    return { label: display, selection: `${display}${blobs ? ` ${blobs}` : ""}` };
  });
  return options.every((o) => o.label.length > 0) ? options : null;
}

/**
 * The citation line never keeps a hidden data marker, and loses a list number
 * only when it is the reply's single numbered line (several numbered lines are
 * a list of options, never silently reduced to one of them).
 */
export function cleanCitationLine(line: string, reply: string): string {
  const withoutBlob = line.replace(BLOB, "").trim();
  const numberedCount = reply.split("\n").filter((l) => NUMBERED.test(l)).length;
  return numberedCount === 1 ? withoutBlob.replace(NUMBERED, "$2").trim() : withoutBlob;
}

/**
 * Foreign rulings found in more than one country: the user picks the country,
 * and one new check runs for that country only. Null when only one country.
 */
export function countryRetryChoice(choices: { jurisdiction: "US" | "UK"; label: string; url: string }[]): RetryChoice | null {
  const groups = new Map<"us" | "uk", CountryOption[]>();
  for (const c of choices.slice(0, MAX_OPTIONS)) {
    const key = c.jurisdiction === "US" ? "us" : "uk";
    groups.set(key, [...(groups.get(key) ?? []), { label: c.label, url: c.url }]);
  }
  if (groups.size < 2) return null;
  return { kind: "country", countries: [...groups.entries()].map(([country, options]) => ({ country, options })) };
}
