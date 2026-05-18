// Step 2.3 — Frame gate probe.
// Asserts doctrinal_frame classification + constitutional gate behavior on
// Q1 (procedural_civil), Q5 (contract), Q7 (procedural_admin/administrative),
// with a Q3 regression (constitutional must still allow Bank Mizrahi / BL §8).
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const QUERIES = [
  {
    id: "Q1", label: "temp injunction",
    question: "מהם התנאים למתן סעד זמני (צו מניעה זמני) במשפט האזרחי הישראלי?",
    expected_frames: ["procedural_civil"],
    expected_seminal: [["תקנה 95"], ["סעיף 75"], ["שפע בר", "רע\"א 4196/93"]],
    require_min_seminal: 1,
    constitutional_allowed: "with_reason",
  },
  {
    id: "Q3", label: "constitutional invalidation (regression)",
    question: "מהם המבחנים לפסילת חוק בלתי חוקתי בישראל?",
    expected_frames: ["constitutional"],
    expected_seminal: [["סעיף 8"], ["סעיף 4"], ["בנק המזרחי", "ע\"א 6821/93"]],
    require_min_seminal: 2,
    constitutional_allowed: "yes",
  },
  {
    id: "Q5", label: "Apropim / contract §25",
    question: "מהם הכללים לפרשנות חוזה במשפט הישראלי לאור הלכת אפרופים והתיקון לסעיף 25 לחוק החוזים?",
    expected_frames: ["contract"],
    expected_seminal: [["אפרופים"], ["מגדלי הירקות"], ["סעיף 25"]],
    require_min_seminal: 2,
    constitutional_allowed: "no",
  },
  {
    id: "Q7", label: "exhaustion of remedies",
    question: "מהי דוקטרינת מיצוי ההליכים במשפט המינהלי הישראלי ומתי בית המשפט יידחה עתירה בשל אי-מיצוי?",
    expected_frames: ["procedural_admin", "administrative"],
    expected_seminal: [["פסטרנק"], ["בתי משפט לעניינים מינהליים"], ["זמיר"]],
    require_min_seminal: 1,
    constitutional_allowed: "with_reason",
  },
];

const CONSTITUTIONAL_RE = /(חוק[- ]?יסוד|בנק\s+המזרחי|לשכת\s+מנהלי\s+ההשקעות|פסקת\s+ה?הגבלה|מידתיות\s+במשפט|עילת\s+ה?סבירות)/;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const results = [];

for (const q of QUERIES) {
  const evalRunId = `s23-${q.id}-${randomUUID().slice(0, 8)}`;
  console.log(`\n===== ${q.id} (${q.label}) — evalRunId=${evalRunId} =====`);
  const t0 = Date.now();
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
      body: JSON.stringify({
        question: q.question, taskMode: "research", depth: "deep",
        evalRunId, requestId: `eval:${evalRunId}`,
      }),
    }).then((r) => r.text());
  } catch (e) {
    console.log(`HTTP error: ${e.message}`);
  }
  console.log(`wall=${Date.now() - t0}ms — polling qa_log…`);

  let row = null;
  for (let i = 0; i < 10; i++) {
    await new Promise((rr) => setTimeout(rr, 2500));
    const { data } = await admin
      .from("qa_logs")
      .select("id, footnotes, metadata, answer")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) { row = data[0]; break; }
  }
  if (!row) { console.log(`NO ROW for ${q.id}`); results.push({ id: q.id, error: "no_row" }); continue; }

  const md = row.metadata || {};
  const v3plan = md.v3_legal_research_plan || {};
  const anchors = v3plan.anchors || [];
  const doctrinal_frame = v3plan.doctrinal_frame ?? null;
  const dropped = v3plan.frame_mismatch_dropped || [];
  const keptWithReason = v3plan.constitutional_anchors_kept_with_reason ?? 0;

  // Frame check
  const frame_ok = q.expected_frames.includes(doctrinal_frame);

  // Seminal coverage
  const allText = anchors.map((a) => `${a.name || ""} ${a.docket || ""} ${a.section || ""}`).join(" | ");
  const seminal_hits = q.expected_seminal.filter((alts) => alts.some((k) => allText.includes(k)));
  const seminal_ok = seminal_hits.length >= q.require_min_seminal;

  // Constitutional gate behavior
  const constitutionalAnchors = anchors.filter((a) =>
    a.type === "basic_law_section" || CONSTITUTIONAL_RE.test(a.name || ""),
  );
  let constitutional_ok = true;
  let constitutional_note = "";
  if (q.constitutional_allowed === "no") {
    constitutional_ok = constitutionalAnchors.length === 0;
    constitutional_note = constitutional_ok ? "none kept (correct)" : `LEAKED: ${constitutionalAnchors.map((a) => a.id).join(",")}`;
  } else if (q.constitutional_allowed === "with_reason") {
    const bad = constitutionalAnchors.filter(
      (a) => !a.constitutional_relevance_reason || a.constitutional_relevance_reason.length < 15,
    );
    constitutional_ok = bad.length === 0;
    constitutional_note = constitutional_ok
      ? `all ${constitutionalAnchors.length} carry reason (or none kept)`
      : `unreasoned: ${bad.map((a) => a.id).join(",")}`;
  } else {
    constitutional_note = "constitutional frame — allowed";
  }

  const summary = {
    id: q.id,
    qa_log_id: row.id,
    v3_path: md.v3_path,
    v1_fallback: !!md.v1_fallback || md.drafting_path === "v1_legacy",
    doctrinal_frame,
    expected_frames: q.expected_frames,
    frame_ok,
    anchor_count: anchors.length,
    anchors: anchors.map((a) => ({
      id: a.id, type: a.type, name: a.name, docket: a.docket, section: a.section,
      centrality: a.centrality,
      ...(a.constitutional_relevance_reason ? { crr: a.constitutional_relevance_reason } : {}),
    })),
    seminal_hits_count: seminal_hits.length,
    seminal_required: q.require_min_seminal,
    seminal_ok,
    constitutional_anchors_count: constitutionalAnchors.length,
    constitutional_anchors_kept_with_reason: keptWithReason,
    frame_mismatch_dropped: dropped,
    constitutional_ok,
    constitutional_note,
    total_footnotes: (row.footnotes || []).length,
    overall_pass: frame_ok && seminal_ok && constitutional_ok && !md.v1_fallback,
  };
  results.push(summary);
  console.log(JSON.stringify(summary, null, 2));
}

console.log("\n\n========== AGGREGATE ==========");
console.log(JSON.stringify(results.map((r) => ({
  id: r.id, v3_path: r.v3_path, frame: r.doctrinal_frame, frame_ok: r.frame_ok,
  seminal: `${r.seminal_hits_count}/${r.seminal_required}`,
  dropped: r.frame_mismatch_dropped?.length, kept_w_reason: r.constitutional_anchors_kept_with_reason,
  constitutional_ok: r.constitutional_ok, overall: r.overall_pass,
})), null, 2));
