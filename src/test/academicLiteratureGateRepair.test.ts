import { describe, expect, it } from "vitest";
import {
  classifyBodyTopicality,
  decideThinPackRecovery,
  isStrongDirectLiteratureCandidate,
} from "../../supabase/functions/legal-research-v1/stages/academicLiteratureGateRepair";

const Q =
  "כתוב סקירת ספרות אקדמית בנושא הביקורת על עילת הסבירות במשפט הציבורי הישראלי, אקטיביזם שיפוטי ושלטון החוק";

describe("isStrongDirectLiteratureCandidate", () => {
  it("admits a real Israeli law-journal article on a mirror host", () => {
    const a = isStrongDirectLiteratureCandidate(Q, {
      candidate_id: "c1",
      title: 'שפירא, "על סבירותה של עילת הסבירות" משפטים כרך נ',
      url: "https://www.academia.edu/12345/reasonableness",
      snippet: "מאמר הבוחן את עילת הסבירות במשפט המנהלי הישראלי וביקורת האקטיביזם השיפוטי",
      source_type: "unknown",
    });
    expect(a.strong_direct).toBe(true);
    expect(a.topicality_score).toBeGreaterThan(0);
  });

  it("refuses marketing/listing pages", () => {
    const a = isStrongDirectLiteratureCandidate(Q, {
      candidate_id: "c2",
      title: "עורך דין מנהלי - ייעוץ משפטי | צור קשר",
      url: "https://lawyer-marketing.co.il/contact",
      snippet: "משרד עורכי דין מציע ייעוץ. התקשרו עכשיו למחירון",
    });
    expect(a.strong_direct).toBe(false);
  });

  it("refuses off-topic scholarship", () => {
    const a = isStrongDirectLiteratureCandidate(Q, {
      candidate_id: "c3",
      title: 'כהן, "רגולציה של אשראי צרכני" עיוני משפט',
      url: "https://law.tau.ac.il/article",
      snippet: "מאמר על אשראי צרכני ובנקאות",
    });
    expect(a.strong_direct).toBe(false);
  });
});

describe("decideThinPackRecovery", () => {
  const strong = [
    isStrongDirectLiteratureCandidate(Q, {
      candidate_id: "c1",
      title: 'שפירא, "על סבירותה של עילת הסבירות" משפטים כרך נ',
      url: "https://www.academia.edu/1",
      snippet: "מאמר על עילת הסבירות במשפט המנהלי הישראלי ואקטיביזם שיפוטי",
      source_type: "unknown",
    }),
  ];

  it("does not trigger outside literature mode", () => {
    const d = decideThinPackRecovery({
      literature_mode: false,
      usable_literature_count: 0,
      strong_direct: strong,
      body_acquired: new Set(),
      definitively_rejected: new Set(),
      budget_allows: true,
    });
    expect(d.triggered).toBe(false);
  });

  it("does not trigger when the pack is not thin", () => {
    const d = decideThinPackRecovery({
      literature_mode: true,
      usable_literature_count: 5,
      strong_direct: strong,
      body_acquired: new Set(),
      definitively_rejected: new Set(),
      budget_allows: true,
    });
    expect(d.triggered).toBe(false);
    expect(d.trigger_reason).toBe("pack_not_thin");
  });

  it("triggers bounded recovery for already-found unfetched candidates", () => {
    const d = decideThinPackRecovery({
      literature_mode: true,
      usable_literature_count: 1,
      strong_direct: strong,
      body_acquired: new Set(),
      definitively_rejected: new Set(),
      budget_allows: true,
    });
    expect(d.triggered).toBe(true);
    expect(d.candidate_ids).toEqual(["c1"]);
    expect(d.bounds.max_candidates).toBeLessThanOrEqual(3);
  });

  it("reports real scarcity rather than inventing candidates", () => {
    const d = decideThinPackRecovery({
      literature_mode: true,
      usable_literature_count: 0,
      strong_direct: [],
      body_acquired: new Set(),
      definitively_rejected: new Set(),
      budget_allows: true,
    });
    expect(d.triggered).toBe(false);
    expect(d.trigger_reason).toContain("real_scarcity");
  });
});

describe("classifyBodyTopicality", () => {
  it("marks an off-topic acquired body ineligible for the pack", () => {
    const r = classifyBodyTopicality(Q, {
      candidate_id: "c9",
      title: "Consumer credit regulation in the EU",
      body: "This paper studies consumer credit markets and banking supervision in Europe.",
    });
    expect(r.eligible_for_pack).toBe(false);
    expect(r.role_after_body).toBe("off_topic");
  });
});
