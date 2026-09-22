<!-- Export of existing Acceptance #3 run artifacts. No product code changed; no run re-executed. Fields absent from the stored artifact are marked `NOT PERSISTED IN RUN ARTIFACT`. -->

# Acceptance #3 — Failed Source Attempts (L5, L7, L8)

HTTP status codes are recorded only where the acquisition ledger captured them;
otherwise the run stored the failure class only (NOT PERSISTED IN RUN ARTIFACT).

---

# L5 — `8cee562e-d2d4-4220-a37d-22eed5f4f8f8`

Run-level same-work / enrichment counters:

```json
{
  "same_work_recovered_host": [
    "www.new.isa.gov.il"
  ],
  "same_work_recovery_basis": [
    "title_and_year"
  ],
  "same_work_candidates_seen": 10,
  "same_work_recovery_failed": 1,
  "same_work_enrichment_basis": [],
  "same_work_recovery_success": 1,
  "same_work_equivalence_basis": [
    "title_and_year"
  ],
  "same_work_enrichment_success": 0,
  "same_work_recovery_triggered": 2,
  "same_work_search_hint_fields": [],
  "same_work_enrichment_conflict": 0,
  "same_work_enrichment_crossref": 0,
  "same_work_enrichment_openalex": 0,
  "same_work_enrichment_triggered": 0,
  "same_work_recovery_query_count": 2,
  "same_work_enrichment_doi_lookup": 0,
  "same_work_enrichment_landing_meta": 0,
  "same_work_recovery_failed_reasons": [
    "no_equivalent_public_copy"
  ],
  "same_work_candidates_rejected_host": 0,
  "same_work_agent_hint_used_for_query": 0,
  "same_work_enrichment_search_metadata": 0,
  "same_work_recovered_after_enrichment": 0,
  "same_work_candidates_rejected_identity": 8,
  "same_work_recovery_skipped_no_identity": 0,
  "same_work_enrichment_still_insufficient": 0,
  "same_work_agent_hint_used_for_equivalence": 0,
  "same_work_original_identity_trusted_fields": [
    "title",
    "year"
  ]
}
```

| source | title | host | failure class | landing page loaded | body chars | final reason |
|---|---|---|---|---|---|---|
| S2 | Constraints on Private Benefits of Control: Ex Ante Control  | core.ac.uk | http_failed | no | 0 | NOT_ACQUIRED / acquisition |
| S3 | חוק החברות, התשנ"ט–1999 - gov.il | www.gov.il | http_failed | no | 0 | NOT_ACQUIRED / acquisition |
| S4 | חוק החברות, התשנ"ט-1999 | www.new.isa.gov.il | unsupported_response | no | 0 | NOT_ACQUIRED / acquisition |

Per-source detail:

- **S2** — Constraints on Private Benefits of Control: Ex Ante Control Mechanisms versus Ex Post Transaction Review
  - url/host: https://core.ac.uk/download/pdf/72835788.pdf (core.ac.uk)
  - HTTP status: http_failed
  - failure class: http_failed · extraction: not_attempted
  - landing page loaded: no
  - direct PDF attempted: NOT PERSISTED IN RUN ARTIFACT
  - same-work recovery / identity enrichment: recorded at run level above (per-source attribution NOT PERSISTED IN RUN ARTIFACT)
  - alternate copy found: www.new.isa.gov.il
  - final reason unavailable: NOT_ACQUIRED / acquisition

- **S3** — חוק החברות, התשנ"ט–1999 - gov.il
  - url/host: https://www.gov.il/BlobFolder/legalinfo/info-and-regulation-15/he/files_InformationAndRegulation_15-law_companieslaw.pdf (www.gov.il)
  - HTTP status: http_failed
  - failure class: http_failed · extraction: not_attempted
  - landing page loaded: no
  - direct PDF attempted: NOT PERSISTED IN RUN ARTIFACT
  - same-work recovery / identity enrichment: recorded at run level above (per-source attribution NOT PERSISTED IN RUN ARTIFACT)
  - alternate copy found: www.new.isa.gov.il
  - final reason unavailable: NOT_ACQUIRED / acquisition

- **S4** — חוק החברות, התשנ"ט-1999
  - url/host: https://www.new.isa.gov.il/images/Fittings/isa/asset_library_pic/al_lobby/al_lobby-628ce07f9490d/Compan01180325.pdf (www.new.isa.gov.il)
  - HTTP status: NOT PERSISTED IN RUN ARTIFACT
  - failure class: unsupported_response · extraction: not_attempted
  - landing page loaded: no
  - direct PDF attempted: NOT PERSISTED IN RUN ARTIFACT
  - same-work recovery / identity enrichment: recorded at run level above (per-source attribution NOT PERSISTED IN RUN ARTIFACT)
  - alternate copy found: www.new.isa.gov.il
  - final reason unavailable: NOT_ACQUIRED / acquisition

Authority acquisition ledger (with HTTP reasons where captured):

```json
[
  {
    "attempts": [
      {
        "at": "2026-09-21T18:54:18.472Z",
        "url": "https://www.gov.il/BlobFolder/legalinfo/info-and-regulation-15/he/files_InformationAndRegulation_15-law_companieslaw.pdf",
        "reason": "http_403_forbidden:http_403",
        "outcome": "failed"
      }
    ],
    "authority_key": "statute:חוק החברות, התשנ\"ט-1999"
  },
  {
    "attempts": [
      {
        "at": "2026-09-21T18:54:50.994Z",
        "url": "https://www.nevo.co.il/law_html/law01/139_002.htm",
        "reason": "body_identity_corroborated:statute_title_present_in_body",
        "outcome": "acquired",
        "identity_corroborated": true
      }
    ],
    "authority_key": "statute:חוק החברות, התשנ\"ט-1999#275",
    "binding_basis": "body_identity_corroborated:statute_title_present_in_body",
    "acquired_source_id": "S8"
  }
]
```

---

# L7 — `48a7e489-87c4-47b4-a194-2ef8076fa37e`

Run-level same-work / enrichment counters:

```json
{
  "same_work_recovered_host": [],
  "same_work_recovery_basis": [],
  "same_work_candidates_seen": 18,
  "same_work_recovery_failed": 4,
  "same_work_enrichment_basis": [
    "search_metadata"
  ],
  "same_work_recovery_success": 0,
  "same_work_equivalence_basis": [],
  "same_work_enrichment_success": 0,
  "same_work_recovery_triggered": 4,
  "same_work_search_hint_fields": [],
  "same_work_enrichment_conflict": 0,
  "same_work_enrichment_crossref": 0,
  "same_work_enrichment_openalex": 0,
  "same_work_enrichment_triggered": 1,
  "same_work_recovery_query_count": 4,
  "same_work_enrichment_doi_lookup": 0,
  "same_work_enrichment_landing_meta": 0,
  "same_work_recovery_failed_reasons": [
    "no_equivalent_public_copy",
    "no_equivalent_public_copy",
    "identity_still_insufficient_after_enrichment",
    "no_results"
  ],
  "same_work_candidates_rejected_host": 0,
  "same_work_agent_hint_used_for_query": 0,
  "same_work_enrichment_search_metadata": 1,
  "same_work_recovered_after_enrichment": 0,
  "same_work_candidates_rejected_identity": 15,
  "same_work_recovery_skipped_no_identity": 1,
  "same_work_enrichment_still_insufficient": 1,
  "same_work_agent_hint_used_for_equivalence": 0,
  "same_work_original_identity_trusted_fields": [
    "title",
    "year"
  ]
}
```

| source | title | host | failure class | landing page loaded | body chars | final reason |
|---|---|---|---|---|---|---|
| S1 | Game On—Copyrighted Tattoos in Video Games as Fair Use | scholarship.law.marquette.edu | http_failed | no | 0 | NOT_ACQUIRED / acquisition |
| S3 | The Player, the Video Game, and the Tattoo Artist: Who Has t | scholarlycommons.law.wlu.edu | http_failed | no | 0 | NOT_ACQUIRED / acquisition |
| S4 | Not a Taboo Use of Tattoos: Why Using Unauthorized Replicas  | scholarship.law.marquette.edu | http_failed | no | 0 | NOT_ACQUIRED / acquisition |
| S5 | Tattoos, Norms, and Implied Licenses | minnesotalawreview.org | http_failed | no | 0 | NOT_ACQUIRED / acquisition |
| S7 | Solid Oak Sketches, LLC v. Visual Concepts, LLC et al., No.  | law.justia.com | http_failed | no | 0 | NOT_ACQUIRED / acquisition |

Per-source detail:

- **S1** — Game On—Copyrighted Tattoos in Video Games as Fair Use
  - url/host: https://scholarship.law.marquette.edu/cgi/viewcontent.cgi?article=5553&context=mulr (scholarship.law.marquette.edu)
  - HTTP status: http_failed
  - failure class: http_failed · extraction: not_attempted
  - landing page loaded: no
  - direct PDF attempted: NOT PERSISTED IN RUN ARTIFACT
  - same-work recovery / identity enrichment: recorded at run level above (per-source attribution NOT PERSISTED IN RUN ARTIFACT)
  - alternate copy found: no
  - final reason unavailable: NOT_ACQUIRED / acquisition

- **S3** — The Player, the Video Game, and the Tattoo Artist: Who Has the Most Skin in the Game?
  - url/host: https://scholarlycommons.law.wlu.edu/cgi/viewcontent.cgi?article=4480&context=wlulr (scholarlycommons.law.wlu.edu)
  - HTTP status: http_failed
  - failure class: http_failed · extraction: not_attempted
  - landing page loaded: no
  - direct PDF attempted: NOT PERSISTED IN RUN ARTIFACT
  - same-work recovery / identity enrichment: recorded at run level above (per-source attribution NOT PERSISTED IN RUN ARTIFACT)
  - alternate copy found: no
  - final reason unavailable: NOT_ACQUIRED / acquisition

- **S4** — Not a Taboo Use of Tattoos: Why Using Unauthorized Replicas of Professional Athlete Tattoos in Video Games Constitutes Fair Use
  - url/host: https://scholarship.law.marquette.edu/cgi/viewcontent.cgi?article=1779&context=sportslaw (scholarship.law.marquette.edu)
  - HTTP status: http_failed
  - failure class: http_failed · extraction: not_attempted
  - landing page loaded: no
  - direct PDF attempted: NOT PERSISTED IN RUN ARTIFACT
  - same-work recovery / identity enrichment: recorded at run level above (per-source attribution NOT PERSISTED IN RUN ARTIFACT)
  - alternate copy found: no
  - final reason unavailable: NOT_ACQUIRED / acquisition

- **S5** — Tattoos, Norms, and Implied Licenses
  - url/host: https://minnesotalawreview.org/wp-content/uploads/2023/03/Perzanowski_Final.pdf (minnesotalawreview.org)
  - HTTP status: http_failed
  - failure class: http_failed · extraction: not_attempted
  - landing page loaded: no
  - direct PDF attempted: NOT PERSISTED IN RUN ARTIFACT
  - same-work recovery / identity enrichment: recorded at run level above (per-source attribution NOT PERSISTED IN RUN ARTIFACT)
  - alternate copy found: no
  - final reason unavailable: NOT_ACQUIRED / acquisition

- **S7** — Solid Oak Sketches, LLC v. Visual Concepts, LLC et al., No. 1:16-cv-00724 (S.D.N.Y. Mar. 26, 2020)
  - url/host: https://law.justia.com/cases/federal/district-courts/new-york/nysdce/1:2016cv00724/452890/164/ (law.justia.com)
  - HTTP status: http_failed
  - failure class: http_failed · extraction: not_attempted
  - landing page loaded: no
  - direct PDF attempted: NOT PERSISTED IN RUN ARTIFACT
  - same-work recovery / identity enrichment: recorded at run level above (per-source attribution NOT PERSISTED IN RUN ARTIFACT)
  - alternate copy found: no
  - final reason unavailable: NOT_ACQUIRED / acquisition

---

# L8 — `1cd5dae4-108b-4542-b411-984527ebe628`

Run-level same-work / enrichment counters:

```json
{
  "same_work_recovered_host": [],
  "same_work_recovery_basis": [],
  "same_work_candidates_seen": 0,
  "same_work_recovery_failed": 0,
  "same_work_enrichment_basis": [],
  "same_work_recovery_success": 0,
  "same_work_equivalence_basis": [],
  "same_work_enrichment_success": 0,
  "same_work_recovery_triggered": 0,
  "same_work_search_hint_fields": [],
  "same_work_enrichment_conflict": 0,
  "same_work_enrichment_crossref": 0,
  "same_work_enrichment_openalex": 0,
  "same_work_enrichment_triggered": 0,
  "same_work_recovery_query_count": 0,
  "same_work_enrichment_doi_lookup": 0,
  "same_work_enrichment_landing_meta": 0,
  "same_work_recovery_failed_reasons": [],
  "same_work_candidates_rejected_host": 0,
  "same_work_agent_hint_used_for_query": 0,
  "same_work_enrichment_search_metadata": 0,
  "same_work_recovered_after_enrichment": 0,
  "same_work_candidates_rejected_identity": 0,
  "same_work_recovery_skipped_no_identity": 0,
  "same_work_enrichment_still_insufficient": 0,
  "same_work_agent_hint_used_for_equivalence": 0,
  "same_work_original_identity_trusted_fields": []
}
```

| source | title | host | failure class | landing page loaded | body chars | final reason |
|---|---|---|---|---|---|---|

Per-source detail:
