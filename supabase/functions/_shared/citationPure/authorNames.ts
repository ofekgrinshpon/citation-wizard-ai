/**
 * Personal-name comparison for foreign books and articles.
 * "Smith, Anthony D" and "Anthony D. Smith" are the same supplied name.
 * The original spelling stays in the citation fields; only comparison is normalized.
 * A shared surname is not enough when a given name differs, and two editions
 * are never merged here.
 */

export interface PersonalName {
  surname: string;
  given: string[];
  suffix?: string;
}

const SUFFIX = /^(?:jr|sr|ii|iii|iv)$/;
const NOT_A_NAME = new Set(["national", "identity", "synthetic", "collection", "review", "journal", "press", "university", "law", "harvard", "oxford", "cambridge", "edition", "volume", "page", "pages", "chapter", "book", "quarterly"]);

function tokens(value: string): string[] {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.’']/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function personFromTokens(list: string[]): PersonalName {
  const suffix = SUFFIX.test(list[list.length - 1] ?? "") ? list.pop() : undefined;
  return { surname: list.pop() ?? "", given: list, ...(suffix ? { suffix } : {}) };
}

/**
 * One author string. A comma is a second person only when both sides are
 * single name-words ("Warren, Louis"). "Smith, Anthony D" and
 * "Holmes, Oliver Wendell" stay one person: the surname is before the comma.
 */
export function authorNameParts(value: string): PersonalName[] | null {
  if (/\bet al\.?/i.test(value)) return null;
  const prepared = value.replace(/,\s*(Jr\.?|Sr\.?|II|III|IV)(?=\s*(?:,|&|and\b|$))/gi, " $1");
  const people: PersonalName[] = [];
  for (const chunk of prepared.split(/\s*(?:&|;)\s*|\s+and\s+/i)) {
    const comma = chunk.match(/^\s*([^,]+),\s*([^,]+)$/);
    if (comma) {
      const left = tokens(comma[1]);
      const right = tokens(comma[2]);
      const inverted = left.length === 1 && right.length >= 1 && (right.length >= 2 || right.some((token) => token.length === 1));
      if (inverted) {
        const suffix = SUFFIX.test(right[right.length - 1] ?? "") ? right.pop() : undefined;
        people.push({ surname: left[0], given: right, ...(suffix ? { suffix } : {}) });
        continue;
      }
      for (const part of chunk.split(/\s*,\s*/)) {
        const list = tokens(part);
        if (list.length) people.push(personFromTokens(list));
      }
      continue;
    }
    const list = tokens(chunk);
    if (list.length) people.push(personFromTokens(list));
  }
  return people.length ? people : null;
}

function samePerson(a: PersonalName, b: PersonalName): boolean {
  if (!a.surname || a.surname !== b.surname) return false;
  if (a.suffix && b.suffix && a.suffix !== b.suffix) return false;
  const full = (name: PersonalName) => name.given.filter((part) => part.length >= 2);
  const aFull = full(a);
  const bFull = full(b);
  if (aFull.length === 0 || bFull.length === 0) return false;
  if (aFull.length !== bFull.length || aFull.some((part, index) => part !== [...bFull].sort()[index] && part !== bFull[index])) {
    const as = [...aFull].sort();
    const bs = [...bFull].sort();
    if (as.length !== bs.length || as.some((part, index) => part !== bs[index])) return false;
  }
  const aInitial = a.given.filter((part) => part.length === 1);
  const bInitial = b.given.filter((part) => part.length === 1);
  if (aInitial.length && bInitial.length) {
    const bs = [...bInitial].sort();
    const as = [...aInitial].sort();
    if (as.length !== bs.length || as.some((part, index) => part !== bs[index])) return false;
  }
  return true;
}

function loosePerson(a: PersonalName, b: PersonalName): boolean {
  if (!a.surname || a.surname !== b.surname) return false;
  if (a.suffix && b.suffix && a.suffix !== b.suffix) return false;
  return a.given.every((part, index) => !b.given[index] || part === b.given[index]
    || (Math.min(part.length, b.given[index].length) === 1 && part[0] === b.given[index][0]));
}

function looseList(left: PersonalName[] | null, right: PersonalName[] | null): boolean {
  if (!left || !right || !left.length || left.length !== right.length) return false;
  return left.every((name, index) => loosePerson(name, right[index]));
}

/** True when either order of each name refers to the same people. Single given names ("Smith, Anthony") are included. */
export function compatiblePersonNames(a: string, b: string): boolean {
  if (looseList(authorNameParts(a), authorNameParts(b))) return true;
  const inverted = (value: string): PersonalName[] | null => {
    const match = value.trim().match(/^([^,]+),\s*([^,]+)$/);
    if (!match) return null;
    const left = tokens(match[1]);
    const right = tokens(match[2]);
    if (left.length !== 1 || right.length < 1 || right.every((token) => token.length < 2)) return null;
    return [{ surname: left[0], given: right }];
  };
  const directA = authorNameParts(a);
  const directB = authorNameParts(b);
  return looseList(inverted(a), directB) || looseList(directA, inverted(b)) || looseList(inverted(a), inverted(b));
}

function contradicts(supplied: PersonalName, candidate: PersonalName): boolean {
  if (candidate.surname !== supplied.surname) return false;
  if (samePerson(supplied, candidate)) return false;
  const suppliedFull = new Set(supplied.given.filter((part) => part.length >= 2));
  const candidateFull = candidate.given.filter((part) => part.length >= 2);
  if (candidateFull.length === 0) return false;
  return candidateFull.some((part) => !suppliedFull.has(part));
}

function nameCandidates(evidence: string): PersonalName[] {
  const found: PersonalName[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    for (const person of authorNameParts(raw) ?? []) {
      if (person.surname.length < 3 || NOT_A_NAME.has(person.surname) || person.given.some((part) => part === person.surname || (part.length > 1 && NOT_A_NAME.has(part)))) continue;
      const key = `${person.surname}|${person.given.join(" ")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(person);
    }
  };
  for (const match of evidence.matchAll(/\b([A-Z][A-Za-z'’.-]{2,}),\s+((?:[A-Z]\.?\s+){0,2}[A-Z][a-zA-Z'’.-]{1,})/g)) add(`${match[1]}, ${match[2]}`);
  for (const clause of evidence.split(/[—–|]|(?:,\s+)|[;:()]+/)) {
    const words = [...clause.matchAll(/[A-Z][A-Za-z'’.-]*/g)].map((match) => match[0]);
    if (words.length >= 2 && words.length <= 4) add(words.join(" "));
  }
  return found;
}

/**
 * The evidence mentions this supplied author. Surname-only text and a different
 * given name are not a match. The supplied string itself is not rewritten.
 */
function wantedPeople(supplied: string): PersonalName[] {
  return authorNameParts(supplied) ?? [];
}

export function authorEvidenceStatus(supplied: string, evidence: string): "match" | "conflict" | "absent" {
  const wanted = wantedPeople(supplied);
  if (!wanted.length || wanted.some((person) => person.surname.length < 3 || person.given.every((part) => part.length < 2))) return "absent";
  const candidates = nameCandidates(evidence);
  if (wanted.some((person) => candidates.some((candidate) => contradicts(person, candidate)))) return "conflict";
  return wanted.every((person) => candidates.some((candidate) => samePerson(person, candidate))) ? "match" : "absent";
}

export function authorEvidenceMatches(supplied: string, evidence: string): boolean {
  return authorEvidenceStatus(supplied, evidence) === "match";
}

/** A supplied author can be checked against a catalog name. An initial-only surname cannot. */
export function authorCanBeMatched(supplied: string): boolean {
  const people = authorNameParts(supplied);
  return !!people?.length && people.every((person) => person.surname.length >= 3 && person.given.some((part) => part.length >= 2));
}
