#!/usr/bin/env python3
"""Summarise one Literature Review Acceptance #2 run, including the new
academic evidence-yield and bibliographic-identity telemetry."""
import json, sys

BASE = ["agent_steps","search_calls","fetch_calls","lookup_calls","raw_web_search_calls",
        "documents_fetched","successful_body_reads","research_claim_count","verified_claim_count",
        "unsupported_claim_count","cited_source_count","footnote_count","latency_ms",
        "prompt_tokens","completion_tokens","chunks_executed","repair_cycles",
        "memo_synthesis_sections","memo_synthesis_relationships","memo_synthesis_source_roles",
        "verified_synthesis_sections","verified_synthesis_relationships",
        "synthesis_claim_refs_dropped","synthesis_source_refs_dropped",
        "verified_sources_available_to_drafter","verified_sources_cited","central_issue_covered"]

ACAD = ["academic_discovered","academic_fetch_attempted","academic_acquired",
        "academic_extracted_usable","academic_quotes_served","academic_sources_memoed",
        "academic_sources_span_verified","academic_sources_support_verified",
        "academic_sources_final_pack","bibliographic_sources_with_metadata",
        "bibliographic_sources_with_authors","bibliographic_citations_rendered",
        "repository_pdf_followed","pdf_continuation_reads","pdf_continuation_chars_added",
        "urls_repaired"]


def main(rid):
    d = json.load(open(f"/tmp/litrev/{rid}.json"))
    t = d.get("telemetry", {}) or {}
    print("===", rid, d.get("run_id"))
    print("BASE", json.dumps({k: t.get(k) for k in BASE}, ensure_ascii=False))
    print("ACAD", json.dumps({k: t.get(k) for k in ACAD}, ensure_ascii=False))
    print("RATIOS", json.dumps(t.get("academic_yield_ratios"), ensure_ascii=False))
    print("-- academic_source_yield")
    for r in t.get("academic_source_yield", []) or []:
        print("  ", r.get("source_id"), "acad" if r.get("academic_source") else "othr",
              "|", (r.get("title") or "")[:60],
              "| acq:", r.get("acquisition_status"), "extr:", r.get("extraction_status"),
              "chars:", r.get("text_chars"),
              "| q:", r.get("quotes_served"), "m:", r.get("memo_evidence_pairs"),
              "sp:", r.get("span_verified_pairs"), "su:", r.get("support_verified_pairs"),
              "|", r.get("outcome"), r.get("terminal_loss_stage"),
              "| bib:", r.get("has_bibliographic"), r.get("metadata_basis"),
              "| cited:", r.get("cited"), "|", (r.get("url") or "")[:70])
    print("-- source funnel")
    for r in t.get("source_funnel", []) or []:
        print("  ", r.get("source_id"), "|", (r.get("title") or "")[:60],
              "|read:", r.get("readable"), "|span:", r.get("span_verified"),
              "|support:", r.get("support_verified"), "|cited:", r.get("cited"),
              "|term:", r.get("terminal_stage"), r.get("rejection_code") or "",
              "|", (r.get("url") or "")[:70])
    print("-- footnotes")
    for f in d.get("footnotes", []) or []:
        print("  ", f.get("index"), (f.get("citation") or "")[:220])
    ans = d.get("answer_markdown") or ""
    print("-- answer chars:", len(ans))
    print(ans[:2500])
    print("-- unresolved:", json.dumps(d.get("unresolved_questions", []), ensure_ascii=False)[:600])


if __name__ == "__main__":
    main(sys.argv[1])
