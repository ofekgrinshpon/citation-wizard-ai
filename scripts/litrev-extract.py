#!/usr/bin/env python3
"""Summarise one literature-review acceptance run from its saved result JSON."""
import json, sys, os

def main(rid):
    p = f"/tmp/litrev/{rid}.json"
    d = json.load(open(p))
    t = d["telemetry"]
    keys = ["agent_steps","search_calls","fetch_calls","lookup_calls","raw_web_search_calls",
            "documents_fetched","successful_body_reads","research_claim_count","verified_claim_count",
            "unsupported_claim_count","cited_source_count","footnote_count","latency_ms",
            "prompt_tokens","completion_tokens","chunks_executed","repair_cycles",
            "memo_synthesis_sections","memo_synthesis_relationships","memo_synthesis_source_roles",
            "verified_synthesis_sections","verified_synthesis_relationships",
            "synthesis_claim_refs_dropped","synthesis_source_refs_dropped",
            "verified_sources_available_to_drafter","verified_sources_cited","central_issue_covered"]
    print("=== ", rid, d.get("run_id"))
    print(json.dumps({k: t.get(k) for k in keys}, ensure_ascii=False))
    print("-- source funnel")
    for r in t.get("source_funnel", []):
        print(" ", r.get("source_id"), "|", (r.get("title") or "")[:70], "|read:", r.get("readable"),
              "|span:", r.get("span_verified"), "|support:", r.get("support_verified"),
              "|cited:", r.get("cited"), "|term:", r.get("terminal_stage"), r.get("rejection_code") or "",
              "|", (r.get("url") or "")[:80])
    print("-- search queries")
    for s in d.get("agent_trace", []):
        if isinstance(s, dict):
            tool = s.get("tool") or s.get("name")
            if tool in ("search", "raw_web_search", "lookup_authority"):
                print(" ", tool, json.dumps(s.get("input") or s.get("args") or {}, ensure_ascii=False)[:200])
    print("-- memo claims")
    for c in (d.get("verified_evidence", {}) or {}).get("claims", []):
        print(" ", c.get("claim_id"), c.get("importance"), "|", c.get("proposition", "")[:150])
        for s in c.get("sources", []):
            print("     <-", s.get("source_id"), (s.get("display_title") or "")[:70], "|", (s.get("locator") or ""))
    print("-- unsupported")
    for c in (d.get("verified_evidence", {}) or {}).get("unsupported_claims", []):
        print(" ", c.get("claim_id"), c.get("importance"), "|", c.get("proposition", "")[:120])
    print("-- footnotes")
    for f in d.get("footnotes", []):
        print(" ", f.get("index"), f.get("citation", "")[:160])
    print("-- answer chars:", len(d.get("answer_markdown") or ""))
    print("-- unresolved:", json.dumps(d.get("unresolved_questions", []), ensure_ascii=False)[:500])

if __name__ == "__main__":
    main(sys.argv[1])
