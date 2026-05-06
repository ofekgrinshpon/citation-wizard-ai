# Memory: index.md

# Project Memory

## Core
- Strict adherence to Uniform Citation Rules (2021). Zero hallucinations: omit unknown metadata or use '(לא נמצאה שנת פרסום)'. Hebrew years require 'ה' prefix.
- Legal QA responses must separate narrative body text (no technical references) from strictly formatted superscript footnotes (¹²³).
- Use **bold** for headings; no markdown headings (#).
- App is ReLex (RTL, inclusive Hebrew text). Models: Gemini 2.5 Flash (via Lovable Gateway), text-embedding-3-small (via OpenAI API directly).
- Data isolated per project (`project_id` & `user_id`) using Row Level Security (RLS). Admin role checks centralized in `private` schema.
- Edge Functions protected by mandatory JWT authorization.
- Unsubscribed users limited to 3 queries shared across all features.

## Memories
- [Foreign Bluebook Rule 36](mem://logic/citation-rules/foreign-bluebook-rule-36) — 9 foreign subtypes (36.1–36.9); React+Deno registries must stay in sync manually
- [Database Schema](mem://db/schema) — Supabase PostgreSQL; `profiles`, `projects`, `citations`, `queries` tables.
- [UI/UX Guidelines](mem://ui/guidelines) — Tailwind CSS, Shadcn UI, RTL support via `dir="rtl"` on root.
- [Deployment](mem://deploy/process) — Vercel for frontend, Supabase for backend/Edge Functions.
