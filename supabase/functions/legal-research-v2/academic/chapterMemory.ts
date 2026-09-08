/**
 * legal-research-v2 — compact chapter memory + minimal source registry.
 *
 * Deterministic: derived from the verified evidence pack and the rendered
 * footnotes of the chapter that was just written. No extra model call, no
 * extra cost, and nothing here can create a claim — it only records what the
 * chapter already established so later chapters stay coherent.
 */

import type { Footnote, VerifiedEvidencePack } from "../types.ts";
import { CONTEXT_LIMITS } from "./projectContext.ts";

export interface ChapterMemory {
  title: string;
  summary: string;
  key_points: string[];
  cited_sources: string[];
  footnotes_count: number;
  version: "chapter-memory-v1";
}

export interface SourceRegistryEntry {
  citation: string;
  url?: string | null;
  authority_key?: string | null;
  chapters_used_in: string[];
}

function clip(s: string, max: number): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Stable identity for a source across chapters: URL when present, else citation. */
export function registryKeyFor(entry: { url?: string | null; citation: string }): string {
  const url = (entry.url ?? "").trim().toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "");
  return url || clip(entry.citation, 200).toLowerCase();
}

export function buildChapterMemory(input: {
  chapterTitle: string;
  pack: VerifiedEvidencePack;
  footnotes: Footnote[];
  citedSourceIds: string[];
}): ChapterMemory {
  const cited = new Set(input.citedSourceIds);
  const claims = input.pack.claims.filter((c) => c.sources.some((s) => cited.has(s.source_id)));
  const core = claims.filter((c) => c.importance === "core");
  const ordered = [...core, ...claims.filter((c) => c.importance !== "core")];

  const key_points = ordered
    .map((c) => clip(c.proposition, CONTEXT_LIMITS.key_point_chars))
    .filter(Boolean)
    .slice(0, CONTEXT_LIMITS.key_points);

  const summary = clip(
    key_points.slice(0, 3).join(" ") || "הפרק נכתב ללא טענות מאומתות.",
    CONTEXT_LIMITS.summary_chars,
  );

  return {
    title: clip(input.chapterTitle, 200),
    summary,
    key_points,
    cited_sources: input.footnotes
      .map((f) => clip(f.citation, CONTEXT_LIMITS.citation_chars))
      .filter(Boolean)
      .slice(0, 12),
    footnotes_count: input.footnotes.length,
    version: "chapter-memory-v1",
  };
}

/** Merge this chapter's footnotes into the project-level source registry. */
export function mergeSourceRegistry(
  existing: SourceRegistryEntry[],
  chapterTitle: string,
  footnotes: Footnote[],
): SourceRegistryEntry[] {
  const byKey = new Map<string, SourceRegistryEntry>();
  for (const e of existing ?? []) {
    if (!e?.citation && !e?.url) continue;
    byKey.set(registryKeyFor(e), {
      citation: clip(e.citation, CONTEXT_LIMITS.citation_chars),
      url: e.url ?? null,
      authority_key: e.authority_key ?? null,
      chapters_used_in: [...new Set(e.chapters_used_in ?? [])].slice(0, 20),
    });
  }
  for (const f of footnotes) {
    const entry: SourceRegistryEntry = {
      citation: clip(f.citation, CONTEXT_LIMITS.citation_chars),
      url: f.url ?? null,
      authority_key: null,
      chapters_used_in: [],
    };
    const key = registryKeyFor(entry);
    const prev = byKey.get(key);
    const chapters = [...new Set([...(prev?.chapters_used_in ?? []), clip(chapterTitle, 200)])];
    byKey.set(key, {
      ...(prev ?? entry),
      citation: prev?.citation || entry.citation,
      url: prev?.url ?? entry.url,
      chapters_used_in: chapters.slice(0, 20),
    });
  }
  return [...byKey.values()].slice(-200);
}
