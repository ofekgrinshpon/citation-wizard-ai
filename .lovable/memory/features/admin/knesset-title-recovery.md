---
name: Knesset Title Recovery
description: Admin tool that mines real titles, authors, and dates from chunk content for Knesset docs ingested with placeholder title "פרטי מסמך"; rejects scrambled OCR; cites per Rule 23.11
type: feature
---
The `recover-knesset-titles` edge function (admin-only) repairs `legal_documents` rows where `source_type='knesset_research'` AND `title='פרטי מסמך'` by mining the first chunk's content.

**Detection**: Hard-rejects scrambled/reversed-OCR PDFs (Latin/symbol noise inside Hebrew, digits glued to Hebrew letters, punctuation before words). If >40% of head lines look scrambled, flag `metadata.broken_title=true` and skip.

**Extraction strategies (in order)**:
1. After section label (`סקירה`, `מבט משווה`, `מסמך רקע לדיון בנושא:`, `נייר רקע`, `דברי הסבר`).
2. After the `כתיבה:` / `עריכה לשונית:` header block (modern format).
3. Longest valid candidate within the first 12 boilerplate-filtered lines.

**Author extraction**: parses `כתיבה: NAME` lines, strips academic titles (Rule 23.2.3 — ד"ר, פרופ', עו"ד, etc.), drops trailing roles (חוקרת, ראש צוות).

**Citation format (Rule 23.11)**:
- With author + year: `{authors} {title} (הכנסת, מרכז מחקר ומידע {year}).`
- Title only: `{title} (הכנסת, מרכז מחקר ומידע {year}).`
- Example: `נועה לפלר ויפעת הולנדר חוק הפקדת ספרים (הכנסת, מרכז מחקר ומידע 2000).`

**Filtering**: `legal-qa/index.ts` skips cards where `source_type='knesset_research'` AND (`title='פרטי מסמך'` OR `metadata.broken_title=true`). Recovered docs flow through normally.

**Ingestion guard**: `ingest-knesset-research/index.ts` rejects new docs with placeholder titles (`פרטי מסמך`, `ללא כותרת`, empty).

**UI**: Admin Batch Embedding panel has a "שחזור כותרות מסמכי הכנסת" button that loops batches of 50 until none remain.
