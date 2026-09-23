/**
 * Registry parity: the frontend registry (src/data/citationEngine.ts) and the
 * Deno fork (supabase/functions/_shared/citationEngine.ts) must not silently
 * drift on rule keys, required fields, rule ids or templates.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CITATION_RULES } from "@/data/citationEngine";

type Rule = {
  primaryRule: string;
  template: string;
  components: { field: string; required: boolean }[];
};

function loadDenoRegistry(): Record<string, Rule> {
  const src = readFileSync(
    resolve(process.cwd(), "supabase/functions/_shared/citationEngine.ts"),
    "utf8",
  );
  // The Deno fork is a plain data module; evaluate its CITATION_RULES literal.
  const start = src.indexOf("export const CITATION_RULES");
  const objStart = src.indexOf("{", start);
  let depth = 0;
  let end = objStart;
  for (let i = objStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const literal = src.slice(objStart, end);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${literal});`)() as Record<string, Rule>;
}

const deno = loadDenoRegistry();

/**
 * Pre-existing Israeli divergences that predate the Bluebook work. The Deno fork
 * intentionally validates a looser field set for the Perplexity resolver.
 * The allowlist is closed: any NEW divergence (and every foreign rule) fails.
 */
const KNOWN_TEMPLATE_DRIFT = new Set([
  "primary_legislation",
  "secondary_legislation",
  "case_law_published",
  "case_law_database",
]);
const KNOWN_REQUIRED_DRIFT = new Set([
  "primary_legislation",
  "basic_law",
  "secondary_legislation",
  "case_law_database",
]);

describe("citation engine registry parity", () => {
  it("every rule present in the Deno fork exists in the frontend registry", () => {
    const missing = Object.keys(deno).filter((k) => !CITATION_RULES[k]);
    expect(missing).toEqual([]);
  });

  it("shared rules agree on primary rule id", () => {
    const diffs: string[] = [];
    for (const key of Object.keys(deno)) {
      const a = CITATION_RULES[key];
      if (!a) continue;
      if (a.primaryRule !== deno[key].primaryRule) {
        diffs.push(`${key}: ${a.primaryRule} ≠ ${deno[key].primaryRule}`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it("shared rules agree on templates", () => {
    const diffs: string[] = [];
    for (const key of Object.keys(deno)) {
      const a = CITATION_RULES[key];
      if (!a) continue;
      if (KNOWN_TEMPLATE_DRIFT.has(key)) continue;
      if (a.template !== deno[key].template) diffs.push(key);
    }
    expect(diffs).toEqual([]);
  });

  it("shared rules agree on required fields", () => {
    const diffs: string[] = [];
    for (const key of Object.keys(deno)) {
      const a = CITATION_RULES[key];
      if (!a) continue;
      const req = (r: Rule) =>
        r.components.filter((c) => c.required).map((c) => c.field).sort().join(",");
      if (KNOWN_REQUIRED_DRIFT.has(key)) continue;
      if (req(a as unknown as Rule) !== req(deno[key])) diffs.push(key);
    }
    expect(diffs).toEqual([]);
  });

  it("no foreign rule may drift at all", () => {
    for (const key of Object.keys(deno).filter((k) => k.startsWith("foreign"))) {
      expect(KNOWN_TEMPLATE_DRIFT.has(key)).toBe(false);
      expect(KNOWN_REQUIRED_DRIFT.has(key)).toBe(false);
      expect(CITATION_RULES[key].template).toBe(deno[key].template);
    }
  });

  it("all foreign families covered by the frontend registry are covered by the fork", () => {
    const foreignFrontend = Object.keys(CITATION_RULES).filter((k) => k.startsWith("foreign_"));
    const missing = foreignFrontend.filter((k) => !deno[k]);
    expect(missing).toEqual([]);
  });
});
