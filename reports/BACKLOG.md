# ReLex — post-beta backlog

## source_label_quality_v2_unread_sources
Status: **open, non-blocking for beta**
Opened: 2026-08-22

Goal: clean raw filenames and ugly/generic labels inside the "sources found but not read"
(unread-source disclosure) lists.

Observed: F07 renders a raw `.docx` filename inside a URL in the unread-source list.

Scope when picked up: display-layer label hygiene for unread/reference-only sources only —
reuse `displayTitleHygiene` + `sourceLabelQuality` on the disclosure list. No retrieval,
classification, verifier, footnote or drafter changes.

Blocking rule: this becomes **beta-blocking only if a raw filename or storage-key style label
appears in the main cited source list** (footnotes / read-in-full list). Unread-list only = ship.
