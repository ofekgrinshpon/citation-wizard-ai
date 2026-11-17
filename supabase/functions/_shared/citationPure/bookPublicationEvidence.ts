/** Publication facts must belong to the requested work, not another date on its page. */
export function extractBookPublicationEvidence(text: string, title: string): { year?: string; edition?: string } {
  if (!title.trim()) return {};
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = title.trim().split(/\s+/).map(escape).join("\\s+");
  const matches = [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu"))];
  const found: Array<{ year: string; edition?: string }> = [];
  for (const match of matches) {
    // A subtitle is part of the same title; never scan through a sentence into another work.
    let tail = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 260);
    tail = tail.replace(/^\s*:\s*[^.();\n]{1,110}(?=\s*\()/, " ");
    const direct = tail.match(/^\s*[,.:;\-–—]?\s*\(\s*(?:(\d+(?:st|nd|rd|th|d)\s+ed\.?|(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+edition)\s*[,;]?\s*)?((?:17|18|19|20)\d{2})\s*\)/i);
    const metadata = tail.match(/^\s*[,.:;\-–—]?\s*(?:(?:publication|published|publication date|publication year|year)\s*:?\s*|(?:[A-Z][\w&'-]*\s+){0,4}(?:University Press|Press|Routledge|Oxford)\s*,?\s*)((?:17|18|19|20)\d{2})\b/i);
    if (direct) found.push({ year: direct[2], ...(direct[1] ? { edition: direct[1] } : {}) });
    else if (metadata) found.push({ year: metadata[1] });
  }
  if (!found.length || new Set(found.map(x => x.year)).size !== 1) return {};
  const editions = new Set(found.map(x => x.edition));
  return { year: found[0].year, ...(editions.size === 1 && found[0].edition ? { edition: found[0].edition } : {}) };
}
