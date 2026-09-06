# fix_topicality_and_role_labelling_v1 — acceptance report

Scope: two deterministic bugs identified by `direct_scholarship_acquisition_failure_audit_v1`.
No new retrieval, no new web search, no new model call, no recovery layer, no forced
source or citation count, no drafter change, no weakening of verifier / CSM / alignment /
source integrity, no fixture-specific source IDs.

## 1. Hebrew topicality normalization

New module `stages/hebrewTopicTerms.ts`. The old stemmer stripped one leading letter and
truncated to five characters (`מנהלית → נהלי`, `המנהלי → מנהלי`), which produced false
mismatches. The replacement is morphological and generic — no legal-term whitelist:

- a word yields a **set of equivalent forms** (surface form + conservative
  prefix-stripped forms), and matching is form-set intersection, so it is symmetric and
  a single wrong stripping decision cannot lose the term;
- prefixes handled: `ה ו ב ל כ ש` and `מה בה לה וה כה שה כש וב ול ומ וכ`, only when a
  ≥3-letter core remains;
- a **bare leading `מ` is never stripped** — in legal vocabulary it is almost always
  lexical (`מנהלי`, `מידתיות`, `משפט`), and stripping it collapses `מנהלי`/`נהלים`;
- endings (`ות ים יות ית יה ה ת י`) are reduced to a fixed point so singular and plural
  converge (`רשויות → רשות → רשו`);
- plene/defective spelling is unified (`מינהל ≡ מנהל`), guarded to ≥4 letters so short
  defective forms (`סביר → סבר`) cannot collide with unrelated words.

Regression coverage in `src/test/topicalityAndRoleLabelling.test.ts` (52 tests): all listed
equivalence pairs pass, plus `חוקתיות/החוקתית`, `שיקול/השיקול`, `תקנה/התקנות`,
`זכות/הזכויות`, `חובה/חובות`, `פרשנות/הפרשנות`, `שוויון/השוויון`, `הליך/ההליכים`.
Negative fixtures confirm the classifier did not become loose:
`סבירות/הסבר`, `מידתיות/מדינה`, `הסתמכות/השתתפות`, `רשות/ירושה`, `מנהלי/נהלים`,
`הבטחה/בטיחות`, `ציפייה/צפייה בטלוויזיה` all stay distinct.

## 2. Dynamic direct threshold

`requiredDirectMatches(questionTermCount, mode)` replaces the fixed floors
(`>= 3` metadata, `>= 4` post-body). The requirement now scales with the question's own
meaningful vocabulary (`ceil(n * 0.5)` metadata / `ceil(n * 0.6)` body, floor 2, cap 3/4),
and `direct` additionally requires:

- a **core topic term** match (one of the three longest non-generic question terms);
- no strong negative body signal (`no_subject_vocabulary_in_body`,
  `body_too_short_to_assess`, `no_core_topic_term_in_body`);
- a body of ≥800 chars for a body-based `direct` verdict.

Request verbs and framing words (`תעשה`, `תכתוב`, `תעזור`, `לבנות`, `סקירת`, `היחס`, …)
are excluded from question vocabulary, so `תעשה לי סקירת ספרות על עילת הסבירות` is scored
on its real doctrine terms and can reach `direct`.

## 3. Body-derived role labelling

New module `stages/bodyDerivedRole.ts`, wired in `index.ts` immediately after secondary
body acquisition and **before** `runVerifier` (verifier role matching reads
`candidate.role`).

The role is recomputed from the document itself — title, host, and body shape:
judgment shape, statute/regulation title or shape, journal identity, footnote density,
institutional research, book, news, listing. Document **identity** takes precedence over
quoted primary law, so a journal article that quotes judgments at length stays scholarship.
A slot role is overridden only on **strong** body evidence (≥800-char body plus an
unambiguous document shape), and a source is never promoted into a primary-authority slot
it did not earn from its own document shape. Integrity, verifier, CSM and alignment gates
are unchanged; only the role they are applied to is corrected.

Telemetry persisted under `drafter.doctrinal_sufficiency_trace`:
`body_derived_role_version`, `source_role_relabelling`
(`original_role`, `retrieval_slot`, `body_derived_role`, `role_changed`, `reason`,
`can_satisfy_role_before/after`) and `topicality_threshold_decisions`
(`question_stems`, `matched_stems`, `old_required_matches`, `new_required_matches`,
`match_ratio`, `core_topic_match`, `negative_signals`, `final_topicality`).

## 4. Live validation (5 natural Hebrew prompts)

| prompt | run_id | footnotes (before → after) | relabel rows / changed | topicality: direct / adjacent / off |
|---|---|---|---|---|
| P1 סקירת ספרות עילת הסבירות | d82cb850 | 4 → 4 | 9 / 1 | 5 / 3 / 1 |
| P2 הבטחה מנהלית וציפייה לגיטימית | 8ec84ec3 | 2 → 3 | 9 / 2 | 1 / 0 / 1 |
| P3 מידתיות מול סבירות | bd36711a | 2 → poll timeout (no terminal row within 15 min) | – | – |
| P4 רקע תיאורטי עילת הסבירות | 644baf40 | 2 → **5** | 24 / 5 | 6 / 3 / 1 |
| P5 פרק ספרות הסתמכות מול רשות | b66be15d | 2 → 1 | 28 / 4 | 1 / 5 / 0 |

The audit's headline regression is fixed: נדב דגן, *מידתיות חוקתית, סבירות מנהלית*
previously carried a stale `primary_statute` slot role with `can_satisfy_role: false`
despite a 16k-char direct body. It is now labelled `journal_article` /
`direct_scholarship` with `can_satisfy_role_after: true` in both P4 and P5, and the same
correction fired for `היסוד החוקתי של עילות הביקורת השיפוטית המינהליות`,
`מי קובע את עקרונות היסוד של השיטה המשפטית?`, `על חוקתיות ועל סבירות`, and
`סמכות בתי-המשפט שאינם בג"ץ להחיל ביקורת שיפוטית`.

Direction of movement: P4 +3 footnotes, P2 +1, P1 unchanged, P5 −1, P3 unresolved
(latency, not classification). No forced counts were added, so per-prompt citation
counts still move with what the drafter actually finds usable.

Latency: 162–365 s, within the observed 161–365 s band; P3 exceeded the 900 s harness poll.

## 5. Tests and build

`bunx vitest run` — 34 files, 378 tests, all passing (52 new).
`legal-research-v1` deployed twice (initial pass, then the document-identity precedence
fix). Build log ends `build OK`.

## 6. Remaining gap and single next step

Relabelling and topicality now let direct scholarship pass the role and topic gates, but
several strong articles still end with `body_evidence_too_weak_to_override_slot` because
their acquired body is short (<800 chars) or listing-like, and P3 still times out.

Next step: `literature_body_completeness_v1` — make acquired scholarship bodies complete
enough to classify and cite (no new discovery, no new sources; bounded re-extraction of
already-found, already-fetched documents whose stored body is truncated).
