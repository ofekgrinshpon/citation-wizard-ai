import { describe, expect, it } from "vitest";
import {
  evaluateScholarshipAdmission,
  extractTopicTerms,
  inferAcademicRoles,
  resolveAcademicRoleSlot,
  summarizeAcademicPackAdmission,
} from "../../supabase/functions/legal-research-v1/stages/academicCandidateAdmission";
import {
  buildPrimaryAnchorAcquisitionReport,
  derivePrimaryAnchorStatus,
} from "../../supabase/functions/legal-research-v1/stages/primaryAnchorAcquisitionStatus";

const TOPIC = extractTopicTerms(
  "מהי דוקטרינת המידתיות בביקורת חוקתית ומה מקורותיה בפסיקה הגרמנית והקנדית",
);

function admit(over: Partial<Parameters<typeof evaluateScholarshipAdmission>[0]>) {
  return evaluateScholarshipAdmission({
    title: "Proportionality and the Culture of Justification",
    url: "https://academic.oup.com/ojls/article/10.1093/ojls/gqx001",
    snippet: "This article argues that proportionality מידתיות reshaped constitutional review.",
    original_class: "unknown",
    topic_terms: TOPIC,
    ...over,
  });
}

describe("academic scholarship admission gate", () => {
  it("admits a topical OUP article with multiple academic signals", () => {
    const d = admit({});
    expect(d.admission_decision).toBe("admitted_as_scholarship");
    expect(d.topical_fit).toBe(true);
    expect(d.admission_signals.length).toBeGreaterThanOrEqual(2);
    expect(d.assigned_source_type).toBe("journal_article");
  });

  it("admits a topical university faculty PDF as `academic`", () => {
    const d = admit({
      title: "הרהורים על מוסכמות מקובלות בשיח המידתיות",
      url: "https://law.haifa.ac.il/images/publications/cohn.pdf",
      snippet: "מאמר זה בוחן את שיח המידתיות בביקורת החוקתית בישראל.",
    });
    expect(d.admission_decision).toBe("admitted_as_scholarship");
    expect(d.assigned_source_type).toBe("academic");
  });

  it("rejects off-topic scholarship", () => {
    const d = admit({
      title: "Maritime Salvage Law: A Review",
      snippet: "This article discusses salvage claims in admiralty courts.",
      topic_terms: extractTopicTerms("דיני מידתיות בביקורת חוקתית"),
    });
    expect(d.admission_decision).toBe("rejected");
    expect(d.rejection_reasons).toContain("off_topic_for_question_and_roles");
  });

  it("rejects citation aggregators and listing/search pages", () => {
    expect(admit({ url: "https://scholar.google.com/citations?user=x" }).rejection_reasons)
      .toContain("citation_aggregator_or_search_index");
    expect(
      admit({ url: "https://academic.oup.com/search?q=proportionality" }).rejection_reasons,
    ).toContain("listing_or_search_page");
  });

  it("rejects commercial SEO pages and sources with no academic provenance", () => {
    const seo = admit({
      title: "עורך דין חוקתי — ייעוץ משפטי חינם בנושא מידתיות",
      url: "https://din-online.info/proportionality",
      snippet: "צור קשר לשיחת ייעוץ",
    });
    expect(seo.admission_decision).toBe("rejected");
    expect(seo.rejection_reasons).toContain("no_credible_academic_provenance");
  });

  it("unknown is reviewed, not auto-admitted: weak signals are rejected", () => {
    const weak = admit({
      title: "מידתיות",
      url: "https://someblog.co.il/post/1",
      snippet: "מידתיות",
    });
    expect(weak.admission_decision).toBe("rejected");
    expect(weak.rejection_reasons).toContain("insufficient_academic_signals");
  });
});

describe("academic role slotting", () => {
  const base = {
    title: "המידתיות במשפט המשווה: גרמניה וקנדה",
    url: "https://law.tau.ac.il/papers/x.pdf",
    snippet: "ביקורת על מבחני המידתיות",
    source_class: "academic",
    topical_fit: true,
  };

  it("reslots a topical scholarship candidate out of a primary slot", () => {
    const d = resolveAcademicRoleSlot({ ...base, original_slot: "primary_statute" });
    expect(d.final_slot).toBe("scholarship");
    expect(d.changed).toBe(true);
    expect(d.assigned_academic_roles).toContain("comparative_source");
  });

  it("never assigns a primary slot", () => {
    const d = resolveAcademicRoleSlot({ ...base, original_slot: "binding_case_law" });
    expect(["scholarship", "government_report", "factual_report", null]).toContain(d.final_slot);
  });

  it("does not reslot off-topic candidates", () => {
    const d = resolveAcademicRoleSlot({ ...base, topical_fit: false, original_slot: "primary_statute" });
    expect(d.final_slot).toBeNull();
    expect(d.rejected_reason).toBe("off_topic_no_role_assignment");
  });

  it("rejects classes with no safe secondary academic slot", () => {
    const d = resolveAcademicRoleSlot({
      ...base,
      source_class: "commercial_secondary",
      original_slot: "primary_statute",
    });
    expect(d.final_slot).toBeNull();
    expect(d.rejected_reason).toContain("no_secondary_academic_slot");
  });

  it("infers critique and theory roles", () => {
    expect(inferAcademicRoles("ביקורת על תורת האיזון")).toEqual(
      expect.arrayContaining(["critique_or_counterposition_source"]),
    );
  });
});

describe("pack admission summary", () => {
  it("is role-aware and reports diversity", () => {
    const s = summarizeAcademicPackAdmission(
      [admit({}), admit({ title: "Off", snippet: "Off", topic_terms: ["nomatch"] })],
      [
        resolveAcademicRoleSlot({
          title: "ביקורת על המידתיות",
          url: "https://law.huji.ac.il/x.pdf",
          original_slot: "primary_statute",
          source_class: "academic",
          topical_fit: true,
        }),
      ],
    );
    expect(s.admitted_count).toBe(2);
    expect(s.rejected_count).toBe(1);
    expect(s.role_diversity_score).toBeGreaterThan(0);
  });
});

describe("primary anchor acquisition status", () => {
  it("distinguishes a 200 mislabelled as a connection reset", () => {
    const row = derivePrimaryAnchorStatus(
      {
        label: 'בג"ץ 9134/12',
        category: "judgment",
        urls_attempted: ["https://supreme.court.gov.il/x.pdf"],
        result: "fetch_failed",
        body_chars: 0,
      },
      [
        { url: "https://supreme.court.gov.il/x.pdf", status: 200, content_length: 90000, connection_reset: false } as never,
        { url: "https://supreme.court.gov.il/x.pdf", status: null, connection_reset: true } as never,
      ],
    );
    expect(row.final_status).toBe("body_received_logged_as_connection_reset");
    expect(row.usable_primary_anchor).toBe(false);
  });

  it("reports metadata-only as unusable and verified bodies as usable", () => {
    const meta = derivePrimaryAnchorStatus({
      label: 'בג"ץ 1/11', category: "judgment", urls_attempted: ["https://x/y"],
      result: "below_threshold", body_chars: 0,
    });
    expect(meta.final_status).toBe("found_metadata_only");
    const ok = derivePrimaryAnchorStatus({
      label: 'בג"ץ 1/11', category: "judgment", urls_attempted: ["https://x/y"],
      result: "body_acquired", body_chars: 20000, identity: { validated: true },
    });
    expect(ok.final_status).toBe("acquired_identity_verified");
    expect(ok.usable_primary_anchor).toBe(true);
  });

  it("flags identity mismatch and true network failure separately", () => {
    expect(
      derivePrimaryAnchorStatus({
        label: "x", category: "judgment", urls_attempted: ["https://x/y"],
        result: "identity_mismatch", body_chars: 5000, identity: { validated: false, reason: "docket" },
      }).final_status,
    ).toBe("identity_mismatch");
    expect(
      derivePrimaryAnchorStatus({
        label: "x", category: "judgment", urls_attempted: ["https://x/y"], result: "blocked_by_origin",
      }).final_status,
    ).toBe("network_or_origin_failure");
  });

  it("summarises only primary categories", () => {
    const rep = buildPrimaryAnchorAcquisitionReport([
      { label: "a", category: "judgment", urls_attempted: ["u"], result: "body_acquired", body_chars: 900, identity: { validated: true } },
      { label: "b", category: "scholarship", result: "not_attempted" },
    ]);
    expect(rep.rows).toHaveLength(1);
    expect(rep.usable_primary_anchor_count).toBe(1);
    expect(rep.all_primary_anchors_failed).toBe(false);
  });
});

describe("recognized research institute provenance", () => {
  const terms = extractTopicTerms("עקרון המידתיות בביקורת חוקתית");
  it("admits an on-topic analytic IDI study", () => {
    const d = evaluateScholarshipAdmission({
      title: "האפקט המצטבר של המידתיות: נדבך חדש בבחינה החוקתית הישראלית",
      url: "https://www.idi.org.il/articles/12345",
      snippet: "",
      original_class: "unknown",
      topic_terms: terms,
    });
    expect(d.admission_decision).toBe("admitted_as_scholarship");
    expect(d.admission_signals).toContain("recognized_research_institute_host");
  });
  it("rejects an off-topic institute page", () => {
    const d = evaluateScholarshipAdmission({
      title: "פסק הדין המלא של בג\"ץ בעניין ביטול עילת הסבירות",
      url: "https://www.idi.org.il/articles/999",
      snippet: "",
      original_class: "unknown",
      topic_terms: extractTopicTerms("תורת ההסתמכות בדיני חוזים"),
    });
    expect(d.admission_decision).toBe("rejected");
  });
  it("still rejects a blog with an analytic title", () => {
    const d = evaluateScholarshipAdmission({
      title: "פסיקתא – סעד קריאה אל תוך החוק וסעד בטלות חלקית בעמדתה של אסתר",
      url: "https://dyoma.co.il/post/123",
      snippet: "",
      original_class: "unknown",
      topic_terms: extractTopicTerms("סעד קריאה לתוך החוק"),
    });
    expect(d.admission_decision).toBe("rejected");
    expect(d.rejection_reasons).toContain("no_credible_academic_provenance");
  });
});

describe("cross-language topical fit", () => {
  const terms = extractTopicTerms("כתוב פרק רקע תיאורטי על עקרון המידתיות בביקורת חוקתית");
  it("admits an English OUP article on the Hebrew topic", () => {
    const d = evaluateScholarshipAdmission({
      title: "Proportionality: Challenging the critics",
      url: "https://academic.oup.com/icon/article/12/3/1",
      snippet: "This article argues that proportionality analysis...",
      original_class: "unknown",
      topic_terms: terms,
    });
    expect(d.topical_fit).toBe(true);
    expect(d.admission_decision).toBe("admitted_as_scholarship");
  });
  it("keeps an unrelated English article off-topic", () => {
    const d = evaluateScholarshipAdmission({
      title: "Maritime Salvage Law in the North Sea",
      url: "https://academic.oup.com/journals/article/9",
      snippet: "This article argues about salvage claims.",
      original_class: "unknown",
      topic_terms: terms,
    });
    expect(d.topical_fit).toBe(false);
    expect(d.admission_decision).toBe("rejected");
  });
});

describe("scholarly repository hosts", () => {
  it("admits an on-topic Digital Commons law-repository article", () => {
    const d = evaluateScholarshipAdmission({
      title: "The Death of Oakes: Time for a Rights-Specific Approach",
      url: "https://digitalcommons.osgoode.yorku.ca/ohlj/vol54/iss2/3/",
      snippet: "This article revisits proportionality review under section 1.",
      original_class: "unknown",
      topic_terms: extractTopicTerms("עקרון המידתיות בביקורת חוקתית"),
    });
    expect(d.admission_decision).toBe("admitted_as_scholarship");
  });
});
