Regenerate `/mnt/documents/legal-research-v1-v2.1d-answers.md` using the correct footnote shape.

**Fix**: read `fn.title`, `fn.url`, `fn.source_type`, and the `fn.sources[]` array (each with `title`, `url`, `source_type`) instead of the non-existent `text`/`citation` fields.

**Output format per footnote**:
- Simple footnote (single source): `N. {title} — {url}` (italicize source_type)
- Compound footnote: `N. {title}` followed by an indented bullet per sub-source: `   - {title} — {url} _({source_type})_`

Everything else stays the same: file path, question headings, per-run telemetry line (ms, sources_used, escalated), the answer body, separators.

No code changes to the edge function or any project file. One-shot regeneration script in `/tmp`, output written only to `/mnt/documents/`.