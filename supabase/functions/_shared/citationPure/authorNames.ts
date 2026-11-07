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
  const initials = value.replace(/\b(?:[A-Z]\.){2,}/g, (mark) => mark.split(".").filter(Boolean).join(" "));
  return initials.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
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

function fullGiven(name: PersonalName): string[] {
  return name.given.filter((part) => part.length >= 2).sort();
}
function initialGiven(name: PersonalName): string[] {
  return name.given.filter((part) => part.length === 1).sort();
}

/**
 * Full given names must be the same set. Initials must be the same set too.
 * An initial present on only one side is not enough to confirm the person.
 */
function samePerson(a: PersonalName, b: PersonalName): boolean {
  if (!a.surname || a.surname !== b.surname) return false;
  if (a.suffix && b.suffix && a.suffix !== b.suffix) return false;
  const aFull = fullGiven(a);
  const bFull = fullGiven(b);
  if (aFull.join("|") !== bFull.join("|")) return false;
  const aInitial = initialGiven(a);
  const bInitial = initialGiven(b);
  if (aInitial.join("|") !== bInitial.join("|")) return false;
  return aFull.length > 0 || aInitial.length > 0;
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

/**
 * Article bylines. A comma between two full words stays a coauthor split
 * ("Warren, Louis" is not treated as one identified person). An initial or a
 * second given name is what makes "Smith, Anthony D." and "Hart, H.L.A." one person.
 */
export function compatiblePersonNames(a: string, b: string): boolean {
  return looseList(authorNameParts(a), authorNameParts(b));
}

function contradicts(supplied: PersonalName, candidate: PersonalName): boolean {
  if (candidate.surname !== supplied.surname || samePerson(supplied, candidate)) return false;
  const suppliedFull = new Set(fullGiven(supplied));
  const candidateFull = fullGiven(candidate);
  if (candidateFull.some((part) => !suppliedFull.has(part))) return true;
  const suppliedInitial = initialGiven(supplied);
  const candidateInitial = initialGiven(candidate);
  return suppliedInitial.length > 0 && candidateInitial.length > 0 && suppliedInitial.join("|") !== candidateInitial.join("|");
}

/** Bibliographic "Surname, Given" including a single given name or initials. Not used for article coauthor lists. */
function bylineReading(value: string): PersonalName[] | null {
  const match = value.trim().match(/^([^,]+),\s*([^,]+)$/);
  if (!match) return null;
  const left = tokens(match[1]);
  const right = tokens(match[2]);
  if (left.length !== 1 || left[0].length < 3 || right.length < 1) return null;
  if (!right.some((token) => token.length >= 2) && right.length < 2) return null;
  return [{ surname: left[0], given: right }];
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
  const primary = wantedPeople(supplied).filter((person) => person.surname.length >= 3 && (fullGiven(person).length > 0 || initialGiven(person).length > 0));
  const inverted = bylineReading(supplied);
  const readings = primary.length ? [primary] : [];
  if (inverted && !primary.length) readings.push(inverted);
  if (!readings.length) return "absent";
  const candidates = nameCandidates(evidence);
  let conflict = false;
  for (const people of readings) {
    const matched = people.every((person) => candidates.some((candidate) => samePerson(person, candidate)));
    const contradicted = people.some((person) => candidates.some((candidate) => contradicts(person, candidate)));
    if (matched && !contradicted) return "match";
    if (contradicted) conflict = true;
  }
  return conflict ? "conflict" : "absent";
}

export function authorEvidenceMatches(supplied: string, evidence: string): boolean {
  return authorEvidenceStatus(supplied, evidence) === "match";
}

/** A supplied author can be checked against a catalog name. An initial-only surname cannot. */
export function authorCanBeMatched(supplied: string): boolean {
  const people = authorNameParts(supplied) ?? [];
  const usable = people.some((person) => person.surname.length >= 3 && (fullGiven(person).length > 0 || initialGiven(person).length > 1));
  if (usable && people.every((person) => person.surname.length >= 3 && (fullGiven(person).length > 0 || initialGiven(person).length > 0))) return true;
  return !!bylineReading(supplied);
}
