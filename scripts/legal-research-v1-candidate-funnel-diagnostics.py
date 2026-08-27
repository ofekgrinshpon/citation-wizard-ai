#!/usr/bin/env python3
"""candidate_funnel_diagnostics_v1 — read-only candidate funnel builder.

Reads qa_logs telemetry for a set of validation runs (run_id list taken from
reports/source-use-intent/results.json) and reconstructs, per candidate:
discovery -> acquisition -> typing/integrity -> verifier -> sufficiency /
claim-match / final use -> budget.

Diagnostics only. Changes no pipeline behaviour. Writes:
  reports/candidate-funnel/funnel.json          (machine readable)
  reports/candidate-funnel/DIAGNOSTICS_REPORT.md (human readable, hand-annotated
                                                  analysis sections appended)
Usage: python3 scripts/legal-research-v1-candidate-funnel-diagnostics.py
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "reports/source-use-intent/results.json")
OUT_DIR = os.path.join(ROOT, "reports/candidate-funnel")


def load_metadata(run_id):
    """Largest (i.e. terminal, non-trace) qa_logs row for this run_id."""
    q = ("select metadata::text from qa_logs where metadata->>'run_id'='%s' "
         "order by length(metadata::text) desc limit 1" % run_id)
    r = subprocess.run(["psql", "-At", "-c", q], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        return None
    return json.loads(r.stdout)


def host_of(url):
    if not url:
        return None
    u = str(url)
    if "://" in u:
        u = u.split("://", 1)[1]
    return u.split("/", 1)[0] or None


def discovered_by(cand, sec_by_id, cache_ids, nomination_titles):
    origin = cand.get("origin")
    method = cand.get("retrieval_method")
    cid = cand.get("candidate_id")
    if cid in cache_ids:
        return "cache"
    sec = sec_by_id.get(cid)
    if sec and sec.get("acquisition_path", "").startswith("web"):
        return "secondary_web"
    md = cand.get("metadata") or {}
    if md.get("official_discovery") or md.get("search_first"):
        return "official_discovery"
    if md.get("nomination_id") or (cand.get("title") in nomination_titles):
        return "nomination"
    if origin == "local_db":
        return "local_retrieval"
    if origin == "perplexity" or method == "perplexity":
        return "perplexity"
    return "other"


def build_run(name, md):
    retr = md.get("retrieval") or {}
    drafter = md.get("drafter") or {}
    verifier = md.get("verifier") or {}

    cands = md.get("candidates") or []
    integrity = (retr.get("source_integrity") or {})
    adm = {a["candidate_id"]: a for a in (integrity.get("admitted") or [])}
    downgrades = {}
    for d in integrity.get("downgrades") or []:
        downgrades.setdefault(d["candidate_id"], []).append(d.get("reason"))

    sec = retr.get("secondary_body_acquisition") or {}
    sec_by_id = {p["candidate_id"]: p for p in (sec.get("per_candidate") or [])}

    cache = drafter.get("verified_source_cache") or {}
    cache_ids = set(cache.get("hit_candidate_ids") or [])

    nom = drafter.get("source_nomination") or {}
    nom_titles = {c.get("label_he") for c in (nom.get("candidates") or [])}

    # verdicts (best support per candidate)
    order = {"direct": 3, "partial": 2, "tangential": 1, "unrelated": 0}
    best = {}
    for v in verifier.get("verdicts") or []:
        cid = v.get("candidate_id")
        cur = best.get(cid)
        if not cur or order.get(v.get("support"), -1) > order.get(cur.get("support"), -1):
            best[cid] = v
    vdropped = {d["candidate_id"]: d for d in (verifier.get("dropped") or [])}
    vusable = {u["candidate_id"]: u for u in (verifier.get("usable") or [])}

    # ref -> candidate_id map (source_label_quality rows are the drafter pack)
    slq = (drafter.get("source_label_quality") or {}).get("rows") or []
    ref2cid = {r["ref"]: r.get("candidate_id") for r in slq}
    cid2ref = {v: k for k, v in ref2cid.items() if v}

    suff = drafter.get("source_sufficiency") or {}
    buckets = suff.get("source_buckets") or {}
    read_in_full = set(buckets.get("read_in_full") or [])
    found_only = set(buckets.get("found_only") or [])
    dropped_unrelated = set(buckets.get("dropped_unrelated") or [])
    role_sets = {
        "primary": set(suff.get("governing_statute_refs") or []) | set(suff.get("usable_judgment_refs") or []),
        "doctrinal_secondary": set(suff.get("doctrinal_secondary_refs") or []),
        "topical": set(suff.get("topical_authority_refs") or []),
    }

    doct = drafter.get("doctrinal_typing") or {}
    elig = {e["ref"]: e for e in (doct.get("eligibility") or [])}

    csm = drafter.get("claim_source_match") or {}
    csm_applied = bool(csm.get("applied"))
    csm_dropped = {}
    for d in csm.get("dropped_source_refs") or []:
        csm_dropped[d["ref"]] = d.get("reason")
    csm_kept = set()
    for c in csm.get("claim_categories") or []:
        csm_kept |= set(c.get("kept_refs") or [])

    used = {u.get("candidate_id"): u for u in (drafter.get("used_sources") or [])}
    omitted = set(drafter.get("omitted_candidate_ids") or [])

    pool_drops = {}
    for d in ((retr.get("pool") or {}).get("drops") or []):
        pool_drops[d.get("candidate_id")] = d
    for d in (md.get("dropped_sources") or []):
        pool_drops.setdefault(d.get("title"), d)

    budget = retr.get("retrieval_budget") or {}

    rows = []
    for i, c in enumerate(cands):
        cid = c.get("candidate_id")
        cmd = c.get("metadata") or {}
        si = cmd.get("source_integrity") or {}
        a = adm.get(cid) or {}
        s = sec_by_id.get(cid) or {}
        ref = cid2ref.get(cid)
        v = best.get(cid)
        e = elig.get(ref) if ref else None

        if ref and ref in read_in_full:
            srole = "primary" if ref in role_sets["primary"] else (
                "doctrinal_secondary" if ref in role_sets["doctrinal_secondary"] else "background")
        elif ref and ref in found_only:
            srole = "found_only"
        elif ref and ref in dropped_unrelated:
            srole = "ignored"
        elif ref:
            srole = "background"
        else:
            srole = "ignored"

        if not csm_applied:
            cm = "not_run"
        elif ref in csm_kept:
            # kept in at least one answer block wins over per-block drops
            cm = "passed"
        elif ref in csm_dropped:
            cm = "dropped"
        else:
            cm = "not_run"

        sup = (v or {}).get("support")
        subtype = (v or {}).get("support_subtype")
        if sup == "direct" and subtype in ("exact_subject", None):
            centrality = "central"
        elif sup in ("direct", "partial"):
            centrality = "useful"
        elif sup == "tangential":
            centrality = "background"
        elif sup == "unrelated":
            centrality = "unrelated"
        else:
            centrality = "unknown"

        body_chars = s.get("body_chars") or cmd.get("available_text_length") or len(c.get("snippet") or "")
        acquired = bool(s.get("ok")) or (a.get("text_usability") == "full_text")

        no_reason = None
        if cid not in used:
            if ref is None:
                no_reason = pool_drops.get(cid, {}).get("drop_reason") or (
                    vdropped.get(cid, {}).get("reason") or "not_carried_into_drafter_pack")
            elif cm == "dropped":
                no_reason = "claim_source_match:" + str(csm_dropped.get(ref))
            elif srole in ("ignored", "found_only"):
                no_reason = "sufficiency_bucket:" + srole
            elif cid in omitted:
                no_reason = "drafter_omitted"
            else:
                no_reason = "drafter_did_not_cite"

        rows.append({
            "discovery": {
                "candidate_id": cid,
                "ref": ref,
                "title": c.get("title"),
                "url": c.get("source_url"),
                "source_type": c.get("source_type"),
                "host": host_of(c.get("source_url")),
                "discovered_by": discovered_by(c, sec_by_id, cache_ids, nom_titles),
                "query_he": c.get("query_he"),
                "claim_id": c.get("claim_id"),
                "rank": i + 1,
                "score": c.get("score"),
            },
            "acquisition": {
                "local_lookup_attempted": bool(s) and s.get("local_body_found") is not None,
                "local_body_found": s.get("local_body_found"),
                "cache_hit": cid in cache_ids,
                "web_fetch_attempted": bool(s.get("web_attempted")),
                "final_url": s.get("final_url"),
                "content_type": s.get("content_type"),
                "body_acquired": acquired,
                "body_chars": body_chars,
                "acquisition_path": s.get("acquisition_path"),
                "acquisition_failure_reason": s.get("failure_reason") or (
                    None if acquired else "no_body_acquisition_attempted"),
                "ms": s.get("ms"),
            },
            "typing_integrity": {
                "original_source_type": a.get("original_source_type") or si.get("classification_before") or c.get("source_type"),
                "mapped_type": si.get("classification_after") or c.get("source_type"),
                "authority_tier": a.get("authority_tier") or si.get("authority_tier"),
                "citable_as": a.get("citable_as") or si.get("citable_as"),
                "text_usability": a.get("text_usability") or si.get("text_usability"),
                "integrity_rejected": bool(si.get("reject")),
                "integrity_flags": a.get("integrity_flags") or si.get("integrity_flags") or [],
                "downgrade_reasons": downgrades.get(cid, []),
                "doctrinal_eligible": (e or {}).get("eligible"),
                "eligibility_reason": (e or {}).get("reason") or ("reason_missing" if ref else "not_in_drafter_pack"),
            },
            "relevance": {
                "verifier_verdict": sup or "not_verified",
                "verifier_reason": (v or {}).get("reason") or ("reason_missing" if cid in vdropped else "not_verified"),
                "support_subtype": subtype,
                "role_match": (v or {}).get("role_match"),
                "verifier_usable": cid in vusable,
                "centrality_label": centrality,
            },
            "final_use": {
                "in_sufficiency": ref is not None,
                "sufficiency_role": srole,
                "claim_source_match": cm,
                "claim_match_drop_reason": csm_dropped.get(ref),
                "used_in_answer": cid in used,
                "footnote_number": (used.get(cid) or {}).get("number"),
                "displayed_as_found_only": bool(ref and ref in found_only),
                "dropped_unrelated": bool(ref and ref in dropped_unrelated),
                "not_used_reason": no_reason,
            },
            "budget": {
                "skipped_by_budget": bool(s.get("skipped_by_budget")),
                "budget_cap": "secondary_body_acquisition_budget" if s.get("skipped_by_budget") else None,
            },
        })

    def cnt(pred):
        return sum(1 for r in rows if pred(r))

    fail_reasons = {}
    for r in rows:
        if not r["acquisition"]["body_acquired"]:
            k = r["acquisition"]["acquisition_failure_reason"] or "reason_missing"
            fail_reasons[k] = fail_reasons.get(k, 0) + 1

    by_disc = {}
    for r in rows:
        k = r["discovery"]["discovered_by"]
        by_disc[k] = by_disc.get(k, 0) + 1

    verd = {}
    for r in rows:
        k = r["relevance"]["verifier_verdict"]
        verd[k] = verd.get(k, 0) + 1

    lost = sorted(
        [r for r in rows if not r["final_use"]["used_in_answer"]
         and r["relevance"]["verifier_verdict"] in ("direct", "partial")],
        key=lambda r: (r["relevance"]["verifier_verdict"] != "direct", -(r["acquisition"]["body_chars"] or 0)),
    )[:5]

    summary = {
        "total_discovered": len(rows),
        "discovered_by": by_disc,
        "acquired_bodies": cnt(lambda r: r["acquisition"]["body_acquired"]),
        "acquisition_failures_by_reason": fail_reasons,
        "verifier_counts": verd,
        "eligible_secondaries": cnt(lambda r: r["typing_integrity"]["doctrinal_eligible"] is True),
        "passed_sufficiency": cnt(lambda r: r["final_use"]["sufficiency_role"] in
                                  ("primary", "doctrinal_secondary", "institutional_report", "background")
                                  and r["final_use"]["in_sufficiency"]),
        "passed_claim_source_match": cnt(lambda r: r["final_use"]["claim_source_match"] == "passed"),
        "cited_footnotes": cnt(lambda r: r["final_use"]["used_in_answer"]),
        "found_only_shown": cnt(lambda r: r["final_use"]["displayed_as_found_only"]),
        "unrelated_dropped": cnt(lambda r: r["final_use"]["dropped_unrelated"]),
        "drafter_pack_size": len(cid2ref),
        "sufficient": suff.get("sufficient"),
        "sufficiency_reason": suff.get("reason"),
        "deterministic_branch": drafter.get("deterministic_branch"),
        "retrieval_ms": retr.get("ms"),
        "retrieval_budget_exceeded": bool(budget.get("budget_exceeded") or budget.get("exceeded")),
        "secondary_stage": {k: sec.get(k) for k in
                            ("ran", "reason", "local_hits", "local_lookups", "web_attempts", "ms")},
        "top_lost_candidates": [
            {"title": r["discovery"]["title"], "verdict": r["relevance"]["verifier_verdict"],
             "body_chars": r["acquisition"]["body_chars"],
             "reason": r["final_use"]["not_used_reason"]} for r in lost],
    }
    return {"run": name, "summary": summary, "candidates": rows}


def main():
    runs = json.load(open(SRC))
    os.makedirs(OUT_DIR, exist_ok=True)
    out = []
    for r in runs:
        md = load_metadata(r["run_id"])
        if md is None:
            out.append({"run": r["id"], "error": "no_telemetry_row"})
            continue
        f = build_run(r["id"], md)
        f["run_id"] = r["run_id"]
        out.append(f)
        print(r["id"], f["summary"]["total_discovered"], "cands,",
              f["summary"]["cited_footnotes"], "cited", file=sys.stderr)
    json.dump(out, open(os.path.join(OUT_DIR, "funnel.json"), "w"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
