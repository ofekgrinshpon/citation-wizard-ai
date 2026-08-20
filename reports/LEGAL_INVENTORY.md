# ReLex — Factual Product & Technical Inventory (for Privacy Policy / Terms drafting)

Read-only audit. "unknown" = not determinable from code/database.

## 1. Product identity
- App name: **ReLex** (`index.html` title "ReLex — Smart Legal Citations"; `src/components/ReLexLogo.tsx`).
- Legal entity / owner: **unknown** — no company name, VAT/ח.פ., or address anywhere in code or DB. Check business registration / bank / payment onboarding.
- Contact email in app: **none**. Only `noreply@<FROM_DOMAIN>` in `supabase/functions/auth-email-hook/index.ts`.
- Website/domain: relexlm.com, www.relexlm.com (canonical in `index.html`).
- Production URL: https://relexlm.com (also https://citation-wizard-ai.lovable.app).
- App stores: none. There is a **Microsoft Word add-in** (`manifest.xml`, `?addin=1`, `src/hooks/useOffice.tsx`) — Office Store submission status unknown.
- Target users: law students, researchers, lawyers.
- Minors: not intended, but **no age gate and no age statement anywhere**.
- Territory: Hebrew/RTL, Israeli law content — **no geo restriction in code**; globally reachable.
- Languages: Hebrew UI (RTL). Some English/foreign citation support in the engine.
- Commercial model: **credits + plans**, currently free in practice — payment is not wired (`src/pages/Profile.tsx:266` → toast "תשלום יתחבר בקרוב").

## 2. Accounts and authentication
- Provider: Supabase Auth (Lovable Cloud), client `src/integrations/supabase/client.ts`, session in `localStorage`.
- Email + password: yes (`src/pages/Auth.tsx`, min length 6).
- Google OAuth: yes (`lovable.auth.signInWithOAuth("google")`, `src/pages/Auth.tsx:51,218`, `src/pages/AuthDialog.tsx:98`; Word add-in dialog flow in `src/lib/officeAuth.ts`).
- Magic link / phone / other social: no.
- Profile fields collected at signup: `full_name`, `email`, optional `referral_code` (from `?ref=`, held in `sessionStorage["relex_ref_code"]`).
- Email verification: signup toast says "בדוק את האימייל לאימות"; custom auth emails via `auth-email-hook`. 16 of 18 auth users confirmed. Exact Supabase "confirm email" setting: **unknown — check Auth settings**.
- Account deletion: **not implemented** (no delete-account UI or function).
- Password reset: yes (`src/pages/ResetPassword.tsx`, `resetPasswordForEmail`).
- Admin role: yes — `public.user_roles` + `private.has_role()`; 2 admins today; `/admin` (`src/pages/Admin.tsx`).
- Plans/credits: `public.profiles` (`plan`, `included_credits_remaining/total`, `topup_credits_remaining`, `billing_period_*`, `credits_reset_mode`, `referral_code`, `referred_by_user_id`, `referral_bonus_granted`, `citation_count`, `is_subscribed`) and `public.credit_ledger`. Plan table in `src/lib/plans.ts`; costs in `src/lib/creditCosts.ts`.

## 3. Personal data collected
| Category | Collected | Where collected | Stored | Purpose | Retention | User can delete |
|---|---|---|---|---|---|---|
| Name | Yes | signup / profile | `profiles.full_name` | identification | none defined | edit only |
| Email | Yes | signup/OAuth | `auth.users`, `profiles.email`, `email_send_log.recipient_email`, `email_unsubscribe_tokens.email` | login, email | none | no |
| Phone | No | — | — | — | — | — |
| Institution/university | No | — | — | — | — | — |
| User role | Yes | admin-assigned | `user_roles.role` | access control | none | no |
| Payment info | No (not implemented) | — | — | — | — | — |
| Billing/subscription status | Yes | system | `profiles.plan/is_subscribed/billing_period_*` | entitlement | none | no |
| Usage history | Yes | every action | `activity_logs`, `qa_logs`, `citation_history`, `credit_ledger`, `legal_research_jobs` | product, billing, admin stats | none | partial (`citation_history` deletable) |
| Login history | Only Supabase-internal `auth.users.last_sign_in_at`/auth audit | — | auth schema | security | Supabase default | no |
| IP address | Not stored in app tables; present in Supabase/edge platform logs | platform | platform logs | ops | platform default (**unknown**) | no |
| Device/browser | Not stored in app tables; platform logs only | | | | | |
| Uploaded files | Yes | Legal Research panel | storage bucket `user-documents` (private) | grounding answers | **never deleted** | via storage policy only, no UI |
| Prompts/questions | Yes | all modes | `qa_logs.question`, `legal_research_jobs.question`, `citation_history.raw_input`, `academic_sessions` | answering, telemetry | none | no UI |
| Generated answers | Yes | | `qa_logs.answer/footnotes/metadata`, `legal_research_jobs.result` | history, debugging | none | no UI |
| Feedback/rating | **No feature exists** | — | — | — | — | — |
| Support messages | No in-app channel | — | — | — | — | — |
| Referral data | Yes | `?ref=` link | `profiles.referral_code`, `referred_by_user_id`, ledger `referral_bonus` | referral bonus | none | no |
| Analytics identifiers | None (no third-party analytics) | — | own tables only | — | — | — |
| Cookies/localStorage | Yes | browser | see §15 | session + drafts | until cleared | user-clearable |

## 4. User-generated content
| Type | Stored | May contain personal/legal data | Reused for future answers | Admin-visible | User can delete | Sent to AI vendors |
|---|---|---|---|---|---|---|
| Legal questions / prompts | `qa_logs.question`, `legal_research_jobs.question` | Yes | No training/reuse in-app | Yes (admin RLS) | No | Yes |
| Uploaded documents | bucket `user-documents` + extracted text in prompts | Yes, often confidential | No | Only via service role (no admin UI) | No UI | Yes (extracted text) |
| Citations entered | `citation_history.raw_input/formatted_output` | Possibly | No | via admin drilldown of activity, not raw table | **Yes** (DELETE policy) | Yes |
| Academic writing sessions | `academic_sessions` (+ localStorage) | Yes | No | No admin policy on this table | Yes (DELETE policy), no UI button | Yes |
| Generated outlines/answers/footnotes/bibliographies | `qa_logs`, `academic_sessions`, `legal_research_jobs.result`, localStorage | Yes | No | Yes | No | produced by AI |
| Document check sessions | `document_check_sessions` (notes/decisions JSON) | Yes | No | Yes (admin read) | Yes (policy) | Yes |
| Notes / feedback / beta feedback / chat support | **No such feature** | — | — | — | — | — |
| Saved/verified sources | `verified_sources` (world-readable) | Bibliographic only, plus `verified_by` user id | Yes — reused for all users | Yes | No | — |

## 5. File uploads
- Enabled: yes, **only** in Legal Research (`src/components/LegalResearchV1Panel.tsx:717`).
- Types: `.pdf`, `.docx` only (`ALLOWED_MIME` in `supabase/functions/legal-research-v1/lib/attachments.ts`).
- Limits: 5 files, 8 MB each (`ATTACHMENT_LIMITS`), text truncated to 12k chars/file, 60k total (36k for docket-matched judgments).
- Storage: bucket **`user-documents`**, `public = false`, path `{user_id}/research/{job_token}/{i}-{name}`. 12 objects today.
- Access: RLS on `storage.objects` restricts SELECT/INSERT/UPDATE/DELETE to `auth.uid() = foldername[1]`. Server reads via service role and creates **signed URLs, TTL 300s**.
- Sent to AI: yes — extracted text goes into prompts to the Lovable AI Gateway (OpenAI/Gemini/Anthropic) and can be cited as footnote sources when the user ticks "השתמש בקבצים גם כמקור בתשובה".
- Parsing: `unpdf` (PDF) and `mammoth` (DOCX) inside the edge function.
- Deletion: **no automatic deletion, no user-facing delete button, no retention job**. Files persist indefinitely.
- Confidentiality handling: no classification, no encryption beyond Supabase at-rest, no DPA-style controls in code.

## 6. AI providers and third-party processors
| Provider | Purpose | Data sent | Prompts | Files/extracted text | Endpoint / env | Essential |
|---|---|---|---|---|---|---|
| Lovable AI Gateway (routes OpenAI GPT-5 / GPT-5-mini, Google Gemini 2.5 Flash / 3 Flash preview) | analysis, planning, drafting, classification, citation engine | prompts, retrieved source text, uploaded-doc text | Yes | Yes | `https://ai.gateway.lovable.dev`, `LOVABLE_API_KEY` | Essential |
| OpenAI (direct) | embeddings + some retrieval | query text, chunk text | Yes | Possibly | `https://api.openai.com`, `OPENAI_API_KEY` | Essential |
| Anthropic | drafter alternative in legal-research-v1 | prompts, sources | Yes | Yes | `lib/anthropic.ts`, `ANTHROPIC_API_KEY` | Configurable |
| Perplexity | web legal retrieval, party lookup, citation refill, bibliography legacy | user query text / derived search queries | Yes (query text) | No | `https://api.perplexity.ai`, `PERPLEXITY_API_KEY` | Essential |
| Supabase (Lovable Cloud) | auth, DB, storage, edge functions, logs | everything | Yes | Yes | project `*.supabase.co` | Essential |
| ConvertAPI | PDF/DOC conversion (`convert-doc`, `verify-case-fulltext`) | document bytes/URLs | No | Yes (court PDFs; admin ingestion path) | `https://v2.convertapi.com`, `CONVERTAPI_SECRET` | Optional |
| Apify | scraping court/Knesset corpora (admin only) | no user data | No | No | `https://api.apify.com`, `APIFY_API_TOKEN` | Optional |
| Court/gov sources fetched directly | source acquisition | no user data | No | No | court.gov.il, knesset.gov.il, gov.il, nevo/takdin links | Essential |
| Email sending | auth + transactional email | email address, name, links | No | No | `auth-email-hook`, `process-email-queue` (pgmq queues) — **actual ESP vendor not visible in code; verify in the email connector** | Essential |
| Stripe / Paddle | **not integrated** | — | — | — | — | — |
| PostHog / GA / Sentry / any analytics or error-monitoring SaaS | **none present** | — | — | — | — | — |
| Vector DB | none external — pgvector inside Supabase (`legal_document_chunks.embedding`) | | | | | |

Training on data: **unknown for every vendor** — depends on account tier/DPA; verify in each vendor's dashboard. Data residency: all of the above are US-based services; **data leaves Israel and the EU**.

## 7. Database inventory (public schema, all RLS-enabled)
| Table | Purpose | Sensitive fields | user_id | Read | Write | Delete | Retention |
|---|---|---|---|---|---|---|---|
| `profiles` | user + plan + credits + referral | email, full_name, plan, credits | `id` | owner, admins | owner (name only, guarded by trigger), admins | none | none |
| `user_roles` | admin/user roles | role | yes | owner, admins | admins | admins | none |
| `credit_ledger` | credit movements (1,986 rows) | reason, metadata | yes | owner, admins | RPC only | none | none |
| `activity_logs` (510) | app actions | action, details JSON | yes | owner, admins | owner insert | none | none |
| `qa_logs` (2,782; 2,639 with answers) | questions + answers + footnotes + metadata | question, answer, metadata | yes | owner, admins | owner insert | none | none |
| `legal_research_jobs` (1,260) | research jobs | question, result | yes | owner, admins | owner insert | none | none |
| `citation_history` (746) | citation inputs/outputs | raw_input, formatted_output | yes | owner | owner | **owner** | none |
| `academic_sessions` (1) | wizard state, outlines, chapters | research_question, chapters | yes | owner | owner | owner | none |
| `document_check_sessions` (1) | uploaded-doc review sessions | file_name, notes, decisions | yes | owner, admins | owner | owner | none |
| `projects` | workspaces | name | yes | owner | owner | owner | none |
| `verified_sources` | shared verified citation store | `verified_by` user id | no | **anyone (public)** | authenticated insert as pending; admins manage | admins | none |
| `legal_documents` / `legal_document_chunks` | corpus + embeddings | none personal | no | **anyone (public)** | admins | admins | none |
| `email_send_log`, `email_unsubscribe_tokens`, `suppressed_emails`, `email_send_state` | email infra | recipient_email, tokens | no | restricted/service | service | mostly denied | `cleanup_email_unsubscribe_tokens()` deletes used/30-day-old tokens — **only automatic deletion in the system** |
| Storage `user-documents` | uploads | full documents | path prefix | owner + service role | owner | owner | none |
| Storage `email-assets` | public images | none | — | **public** | admin/service | — | — |

## 8. RLS and access control
- All 17 public tables have RLS enabled; storage objects policed by folder-prefix policies.
- Users can only reach their own rows everywhere except the intentionally public `legal_documents`, `legal_document_chunks`, `verified_sources`.
- Admins can read: profiles, activity_logs, qa_logs (questions **and** answers), legal_research_jobs, document_check_sessions, credit_ledger, roles. Admins can update any profile and run `set_user_plan` / `add_topup_credits`.
- Service role key is used in edge functions (`legal-research-v1`, `citation-chat`, `legal-qa`, telemetry, ingestion) — bypasses RLS by design.
- Public buckets: `email-assets` only. `user-documents` is private.
- Concerns to flag: (a) admin dashboards expose full prompt + answer text of every user (`Admin.tsx`, `UserUsageDrilldown.tsx`); (b) uploaded files are never deleted; (c) `qa_logs.metadata` telemetry can embed source snippets and possibly excerpts of user documents; (d) `verified_sources` is world-readable and stores `verified_by` user ids; (e) no per-table retention anywhere; (f) no account-deletion path.

## 9. Payments, subscriptions, credits
- Payment: **not enabled**. No Stripe/Paddle code, no payment tables, no invoices. Upgrade button shows "תשלום יתחבר בקרוב" (`Profile.tsx:266`).
- Plans (`src/lib/plans.ts` + DB `_plan_credits`): Basic free 20/mo; Pro חודשי 39₪ 250; Pro סמסטריאלי 129₪ 1,100 / 4 months; Pro שנתי 299₪ 3,600; Admin unlimited. Prices are displayed on the Landing page although nothing can be purchased.
- Credits per action (`src/lib/creditCosts.ts`): citation 1, batch footnote 1/source, bibliography 1/source, legal QA / case summary 5 (+2 with attached document), legal research 5, academic chapter 8 (feature disabled), verified autocomplete 0.
- Renewal/reset: DB function `reset_or_renew_credits()`; modes per plan.
- Refunds: only **credit** auto-refunds on technical failure (`refund_credits` RPC, `src/lib/refundResponse.ts`). No money refund policy, no cancellation flow, no receipts.
- Top-up packs displayed (100/500/2000) but only grantable by admin via `add_topup_credits`.
- Referral: 10 credits to referrer and referee on referee's first consuming action (`grant_referral_bonus_if_eligible`).

## 10. Beta program
- 18 registered users, 16 confirmed, 2 admins, 7 non-basic plans (admin-granted).
- Closed beta is documented internally in `reports/BETA_READINESS.md`; **the app itself contains no beta banner, no beta disclaimer, no invite gating** — signup is open to anyone at /auth.
- Access is free (no payment path).
- Free-month promise to beta users: **unknown — founder decision**.
- Feedback: **no feedback/rating/report-issue feature exists**; feedback is collected out-of-band (WhatsApp/email) — unknown.

## 11. Legal-advice / disclaimer surface
- The UI **never says it is legal advice**, and it also **never says it is not**. There is no disclaimer text on Landing, /app, Legal Research, Legal QA, or footers ("ReLex © 2026" only).
- Warnings that exist are narrow, per-item tooltips: "ייתכן שזהו מקור שגוי שהוחזר ע"י מנוע החיפוש. מומלץ לאמת ידנית לפני שימוש." and "לא הצלחנו לאמת את הקישור..." (`LegalSourceSearchPanel.tsx:747,755`), plus "לא ניתן לאמת" in `CitationReviewPanel.tsx`.
- No global "verify before relying" or "not a substitute for a lawyer" notice.
- Answers are source-grounded with footnotes; refusal branches exist (`docket_limitation`, `insufficient_sources`).
- The product **does distinguish** sources read in full vs. reference-only: heading "מקורות שאותרו אך גופם לא נקרא (לעיון בלבד)" (`stages/metadataOnlyHoldingGate.ts`).
- Features that look advice-adjacent: case summaries, "בקרה למסמכים" (pleading/document audit) which reviews an uploaded legal document and issues notes, and academic writing. It does **not** draft pleadings or contracts, and does not give filing instructions.

## 12. Academic writing feature
- Location: `src/components/LegalQAChat.tsx` (wizard), backend `legal-qa` — **not** routed through `legal-research-v1`.
- Enabled: research-question approval, topic proposals, outline building, abstract/summary generation.
- Disabled: body chapters, intro, conclusion — hard UI guard + server 503; user-facing string at `LegalQAChat.tsx:44`: "כתיבת פרקי גוף, מבוא וסיכום מושבתת זמנית…".
- Footnotes/bibliography inside academic mode: produced by the separate citation tools, not by the wizard.
- Verified sources: uses the general retrieval/verified-source store where the citation engine is invoked; the wizard steps themselves are not source-gated like legal-research-v1.
- Limitations disclosure: none in UI beyond the disabled-notice.
- State stored in `academic_sessions` and localStorage.
- Recommendation for Terms: describe as a **structural writing aid** (question framing, topic ideas, outline), explicitly not a paper-writing service.

## 13. Citation / bibliography / footnotes
- Format: Israeli **כללי האזכור האחיד** (2021 rules) — extensive rule logic in `src/data/citationEngine.ts`, `supabase/functions/citation-chat`, `_shared/*` validators. Foreign sources handled via a Bluebook-ish Rule 36 path.
- Verification: multi-stage — input validation, source-type classification (`classify-source`), verified-source store (`verified_sources`), grounded web verification (Perplexity + court/Knesset sites), docket/party/publication/date conflict gates, editor grounding, Knesset-term correction, rule-completeness validation.
- Normalization: yes (e.g. `normalizeEditorPlacement`, docket normalization, Hebrew number ranges).
- Bibliography and footnotes now run through the same pipeline (`src/lib/runCitation.ts`, `src/lib/concurrency.ts`).
- Results are **AI-generated plus deterministic rules** — they can still be wrong (missing-field warnings like "[חסר: שם כתב העת]" are surfaced).
- Users are warned only per-item, not globally.
- Inputs and outputs are stored in `citation_history` (deletable by user).

## 14. Retention and deletion
- Account deletion: **not implemented**.
- Query/answer deletion by user: **not implemented** (`qa_logs`, `legal_research_jobs` have no DELETE policy at all).
- Citation history, academic sessions, document-check sessions, projects: DELETE policies exist; only citation history and projects have UI.
- Uploaded files: no auto-deletion, no UI deletion.
- Admin deletion of user data: no admin delete UI; would require direct DB/service-role action.
- Automatic deletion anywhere: only `cleanup_email_unsubscribe_tokens()` (used tokens / >30 days).
- Logs: `activity_logs`, `qa_logs`, `credit_ledger` kept forever. Edge-function/platform logs retention: **unknown — Lovable Cloud default**.
- AI-provider retention/training: **unknown** per vendor.
- Backups: managed by Lovable Cloud/Supabase; schedule and retention **unknown**.

## 15. Cookies, analytics, browser storage
- Cookies: only `sidebar:state` UI cookie (`src/components/ui/sidebar.tsx`) — non-essential/functional. Supabase auth session is in **localStorage**, not cookies.
- localStorage keys: Supabase auth token (`sb-<ref>-auth-token`), `relex_current_project`, per-project citation messages/input (`Index.tsx`), batch footnote cells/summary/phase, bibliography entries, academic session (`ACADEMIC_SESSION_KEY`). Memory fallback in `src/lib/safeStorage.ts` when blocked (Word Online).
- sessionStorage keys: `relex_ref_code`, legal-research resume state, source-search turns (≤1 MB budget).
- Analytics scripts / pixels / behavior tracking / marketing cookies / error monitoring SaaS: **none**.
- Third-party script loaded: Microsoft `office.js` only when `?addin=1`.
- Cookie consent banner: **none**.

## 16. Security measures
Implemented: HTTPS (Lovable hosting/custom domain), Supabase Auth with JWT, RLS on every public table, storage folder-scoped policies, private uploads with 300s signed URLs, security-definer role checks (`private.has_role`), credit charge/refund via idempotent RPCs, secrets in Supabase secret store (never in client), a profiles trigger blocking self-service edits to plan/credit/identity fields, in-app activity/error logging (`request_failed` rows), server-side error normalization (`src/lib/functionError.ts`), fail-closed credit charging, bounded concurrency in bulk citation runs, encryption at rest and in transit via Supabase defaults.

Missing or unknown: no application-level rate limiting or abuse throttling (only pass-through 429s from vendors), no CAPTCHA, no MFA, no account lockout, no audit log of admin actions, no DPA/vendor-processor register, no incident-response process in code, no upload malware scanning, no PII redaction before sending prompts to vendors, backup/restore drill status unknown, edge-function log retention unknown, `verify_jwt = false` on many functions in `supabase/config.toml` (they verify the JWT in code, but this should be re-confirmed function by function).

## 17. Prohibited use / abuse controls
None of the following exist as rules or enforcement anywhere in the product: unlawful use, unauthorized practice of law, academic misconduct/plagiarism, uploading confidential third-party material, copyright infringement, scraping of ReLex, automated/bulk abuse, reverse engineering, account sharing, excessive API use, prompt injection by users, malicious file scanning, defamatory content, uploading third parties' personal data. The only limits are technical: credits, file count/size, and vendor rate limits. There is no ToS acceptance checkbox at signup.

## 18. Intellectual property
- Ownership of inputs and outputs: **unknown — no policy exists anywhere**.
- The app does not claim ownership in any UI text.
- Outputs are stored server-side (`qa_logs`, `legal_research_jobs`, `citation_history`) and shown to admins; they are **not** used to train models by ReLex, and verified citation metadata (not user text) can be reused across users via `verified_sources`.
- The corpus (`legal_documents`, `legal_document_chunks`) contains ingested third-party legal texts — court decisions, legislation, Knesset material — some retrieved from Nevo/Takdin/court sites; licensing status **unknown and needs review**.
- Source excerpts/snippets are shown to users in research answers and source search.
- No copyright/licensing warning is shown to users.

## 19. Support and contact
- Support email: **none in the app**.
- In-app contact form / report-issue button: **none**.
- Privacy contact, deletion-request process, refund/cancellation contact: **none**.
- Company address: **none**.
- Only outbound address: `noreply@<FROM_DOMAIN>` in auth emails.

## 20. Existing legal pages
Privacy Policy, Terms of Use, Cookie Policy, Disclaimer, Refund Policy, Beta Terms, Acceptable Use Policy, AI disclaimer — **none exist**. No routes in `src/App.tsx`, no footer links (footer is "© 2026 ReLex. כל הזכויות שמורות." in `Landing.tsx:379`).

## 21. Jurisdiction and governing law
- Nothing in code states governing law, jurisdiction, venue, age limits, or EU/US handling.
- Signals only: Hebrew-only RTL UI, Israeli legal domain, ₪ pricing, `.co.il`/`gov.il` sources, `og:locale = he_IL`.
- Users are not geo-restricted, so EU/GDPR and other regimes may apply in practice. Everything else: **unknown — founder decision**.

## 22. Risk flags
| # | Issue | Severity | Where | Why it matters | Clarification needed |
|---|---|---|---|---|---|
| 1 | No Privacy Policy / Terms / disclaimer at all, no acceptance at signup | High | app-wide | No legal basis disclosure, no liability cap, no AI disclaimer | Entity name + jurisdiction to draft |
| 2 | No legal-advice disclaimer while shipping case summaries and document audits | High | all answer surfaces | UPL and reliance risk | Desired positioning wording |
| 3 | Uploaded legal documents stored forever, no delete UI | High | `user-documents`, `LegalResearchV1Panel.tsx` | Confidential client material; retention promise needed | Retention period to commit to |
| 4 | No account deletion / data export | High | no code path | Data-subject rights (GDPR/Israeli PPL) | Manual process + contact email |
| 5 | Prompts, answers and doc-derived text sent to US vendors (OpenAI/Gemini/Anthropic/Perplexity/ConvertAPI) | High | edge functions | Cross-border transfer disclosure + DPAs | Vendor plan/DPA/training status |
| 6 | Admins can read every user's questions and answers | Medium-High | `Admin.tsx`, admin RLS | Must be disclosed; consider minimization | Who is "admin"? internal policy |
| 7 | Pricing shown but no payment; credits granted manually | Medium | `Landing.tsx`, `Profile.tsx:266` | Misleading-offer risk; Terms must reflect free beta | Beta pricing promises |
| 8 | No abuse/acceptable-use rules or rate limiting | Medium | app-wide | No basis to suspend abusers | Enforcement appetite |
| 9 | Corpus of third-party legal texts, licensing unverified | Medium | `legal_documents`, Apify ingestion | Copyright/database rights | Source licenses |
| 10 | No cookie banner; only functional storage | Low-Medium | app-wide | Likely fine with a Cookie section; confirm no future analytics | Plans to add analytics? |
| 11 | `verified_sources` publicly readable incl. `verified_by` user ids | Low-Medium | RLS | Minor identifier exposure | Keep public? |
| 12 | Open signup with no age gate, minors likely (students) | Medium | `/auth` | Minimum-age clause and parental-consent handling | Minimum age (16/18?) |
| 13 | No security-incident/breach process | Medium | — | Notification duties | Who is responsible contact |
| 14 | Referral bonuses with no rules | Low | `grant_referral_bonus_if_eligible` | Abuse/self-referral terms | Rules and revocation right |
| 15 | Beta with no in-app beta disclaimer | Medium | UI | "As-is" and accuracy caveats | Beta scope and duration |

## 23. Questions the founder must answer before drafting
1. Exact legal entity name, registration number, registered address, and country of establishment (or "individual sole trader" + full name).
2. Public contact email(s): general support, privacy/DPO, deletion requests, billing.
3. Governing law and venue (Israel? which court?). Do you accept EU users, and will you offer GDPR rights?
4. Minimum age for use, and whether under-18 students are allowed.
5. Is ReLex currently free closed beta, and what exactly was promised to beta users (free month? grandfathered pricing? refund on failures)?
6. When does paid billing launch, with which provider, and what refund/cancellation policy?
7. Retention periods you want to commit to for: uploaded files, questions/answers, activity/credit logs, deleted accounts.
8. Do you agree to add: account deletion, per-item deletion of questions/answers, and automatic file deletion (e.g. 30 days)? If yes, I'll implement.
9. For each AI vendor (OpenAI, Google, Anthropic, Perplexity, ConvertAPI, Apify, your email provider): which account/plan is used, is a zero-retention / no-training setting enabled, and do you have DPAs? Check each vendor dashboard.
10. Who may hold admin access, and do you accept that admins can read user prompts/answers (must be disclosed)?
11. What licenses/permissions do you have for the ingested corpus (court decisions, Knesset materials, anything from Nevo/Takdin)?
12. Ownership stance: users own inputs and outputs, with a limited license to ReLex to operate/improve the service? Will you ever train on user content?
13. Will you allow outputs in submitted academic work, and do you want an explicit academic-integrity clause telling users to comply with their institution's rules?
14. How strongly do you want the "not legal advice / verify every source / no attorney-client relationship" disclaimer worded, and where should it appear (signup, footer, above answers)?
15. Are users permitted to upload confidential client files? If yes, what confidentiality commitment are you willing to give?
16. Liability cap and warranty position you want (typically: as-is, capped at fees paid or a small fixed sum).
17. Do you plan to add analytics (PostHog/GA) or error monitoring (Sentry)? That changes the cookie/analytics sections.
18. Is the Word add-in distributed via the Microsoft Store, and does that add store-specific terms?
19. Will there be a formal referral/affiliate program with rules, or keep it informal?
20. Preferred language of the legal documents (Hebrew-only, or Hebrew + English with a controlling version)?
