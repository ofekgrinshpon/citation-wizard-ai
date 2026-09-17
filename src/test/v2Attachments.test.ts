import { describe, expect, it } from "vitest";

import {
  assembleUserDocument,
  ATTACHMENT_LIMITS,
  buildAttachmentManifest,
  chunkText,
  DOCKET_MATCH_LIMITS,
  isLegalPropositionClaim,
  locatorForOffset,
  userDocumentCitationTitle,
  userDocumentIsAuthority,
  validateAttachment,
} from "../../supabase/functions/_shared/userDocumentsCore";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import {
  preloadExtractedDocuments,
} from "../../supabase/functions/legal-research-v2/evidence/userDocumentSources";
import { attachmentContextBlock } from "../../supabase/functions/legal-research-v2/evidence/userDocumentSources";
import { buildIntake } from "../../supabase/functions/legal-research-v2/index";
import { researchFunctionFor, RESEARCH_FUNCTIONS } from "../config/researchPipeline";

const USER = "user-1";

function doc(overrides: Partial<Record<string, unknown>> = {}) {
  const pageA = "סעיף 7 — השוכר ישלם דמי שכירות בסך 5,000 ₪ לחודש. ".repeat(12);
  const pageB = "סעיף 14 — הצדדים מוותרים על תביעות פיצויים. ".repeat(12);
  return assembleUserDocument({
    id: "u1",
    file_name: "הסכם שכירות.pdf",
    mime_type: "application/pdf",
    storage_path: `${USER}/research/job/0-lease.pdf`,
    rawPages: [pageA, pageB],
    docket_match: false,
    remaining_global_chars: ATTACHMENT_LIMITS.MAX_CHARS_TOTAL,
    ...overrides,
  } as Parameters<typeof assembleUserDocument>[0]);
}

describe("attachment metadata validation (ported V1 safety limits)", () => {
  const base = {
    storage_path: `${USER}/research/j/0-a.pdf`,
    file_name: "a.pdf",
    mime_type: "application/pdf",
  };

  it("accepts an owned PDF", () => {
    expect(validateAttachment(base, USER)).toBeNull();
  });

  it("accepts an owned DOCX", () => {
    expect(validateAttachment({
      ...base,
      file_name: "a.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }, USER)).toBeNull();
  });

  it("rejects an unsupported mime type", () => {
    expect(validateAttachment({ ...base, mime_type: "image/png" }, USER)).toBe("unsupported_mime");
  });

  it("rejects another user's storage path", () => {
    expect(validateAttachment({ ...base, storage_path: "someone-else/research/j/0-a.pdf" }, USER))
      .toBe("path_not_owned");
  });

  it("rejects an oversized file", () => {
    expect(validateAttachment({ ...base, size: 20 * 1024 * 1024 }, USER)).toBe("file_too_large");
  });

  it("keeps the shared limits unchanged", () => {
    expect(ATTACHMENT_LIMITS.MAX_FILES).toBe(5);
    expect(ATTACHMENT_LIMITS.MAX_CHARS_TOTAL).toBe(60_000);
    expect(DOCKET_MATCH_LIMITS.MAX_CHARS_PER_FILE).toBe(36_000);
  });

  it("chunks DOCX text into bounded sections", () => {
    const chunks = chunkText("משפט ראשון. ".repeat(500), 400, 3);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 420)).toBe(true);
  });

  it("truncates beyond the per-file cap and reports it", () => {
    const d = assembleUserDocument({
      id: "u1",
      file_name: "big.pdf",
      mime_type: "application/pdf",
      storage_path: `${USER}/research/j/0-big.pdf`,
      rawPages: Array.from({ length: 20 }, () => "א".repeat(5_000)),
      docket_match: false,
      remaining_global_chars: ATTACHMENT_LIMITS.MAX_CHARS_TOTAL,
    });
    expect(d.truncated).toBe(true);
    expect(d.total_chars).toBeLessThanOrEqual(ATTACHMENT_LIMITS.MAX_CHARS_PER_FILE + 10);
  });

  it("gives a docket-matched judgment the expanded limits", () => {
    const d = assembleUserDocument({
      id: "u1",
      file_name: "judgment.pdf",
      mime_type: "application/pdf",
      storage_path: `${USER}/research/j/0-j.pdf`,
      rawPages: Array.from({ length: 20 }, () => "א".repeat(5_000)),
      docket_match: true,
      remaining_global_chars: ATTACHMENT_LIMITS.MAX_CHARS_TOTAL,
    });
    expect(d.total_chars).toBeGreaterThan(ATTACHMENT_LIMITS.MAX_CHARS_PER_FILE);
  });

  it("returns an empty document for an empty PDF", () => {
    const d = doc({ rawPages: ["", "  "] });
    expect(d.pages.length).toBe(0);
    expect(d.text).toBe("");
  });
});

describe("page / locator provenance", () => {
  it("maps an offset back to its page", () => {
    const d = doc();
    const idx = d.text.indexOf("סעיף 14");
    expect(locatorForOffset(d, idx)).toBe("עמ' 2");
    expect(locatorForOffset(d, 0)).toBe("עמ' 1");
  });

  it("never invents Word page numbers", () => {
    const d = doc({
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      file_name: "מכתב.docx",
    });
    expect(locatorForOffset(d, d.text.indexOf("סעיף 14"))).toBe("מקטע 2");
  });

  it("cites the file by title, never by storage path or id", () => {
    expect(userDocumentCitationTitle("הסכם שכירות.pdf")).toBe("הסכם שכירות שצורף");
    expect(userDocumentCitationTitle("claim_form.docx")).toBe("claim form שצורף");
  });
});

describe("claim-type safety", () => {
  it("treats document-content propositions as document claims", () => {
    expect(isLegalPropositionClaim("סעיף 7 להסכם קובע דמי שכירות של 5,000 ₪")).toBe(false);
    expect(isLegalPropositionClaim("במכתב מיום 3.1.2024 נכתב כי ההסכם בוטל")).toBe(false);
  });

  it("treats rules of law as legal propositions", () => {
    expect(isLegalPropositionClaim("הדין בישראל מכיר בתניית פיצוי מוסכם")).toBe(true);
    expect(isLegalPropositionClaim("סעיף 7 להסכם אינו חוקי לפי הדין")).toBe(true);
  });

  it("lets an uploaded judgment be authority only on body corroboration", () => {
    const expected = { dockets: ['ע"א 1234/20'], statutes: [] };
    expect(userDocumentIsAuthority({ dockets: ["1234/20"], statutes: [], sections: [] }, expected))
      .toBe(true);
    // wrong judgment uploaded
    expect(userDocumentIsAuthority({ dockets: ["9999/11"], statutes: [], sections: [] }, expected))
      .toBe(false);
    // filename alone proves nothing: no identity at all
    expect(userDocumentIsAuthority({ dockets: [], statutes: [], sections: [] }, expected))
      .toBe(false);
  });

  it("recognises an uploaded statute text as authority for the named statute", () => {
    const expected = { dockets: [], statutes: [{ statute: "חוק הירושה", section: "25" }] };
    expect(
      userDocumentIsAuthority({ dockets: [], statutes: ["חוק הירושה"], sections: ["25"] }, expected),
    ).toBe(true);
  });
});

describe("EvidenceStore preload", () => {
  it("preloads each file as its own source with provenance", async () => {
    const store = new EvidenceStore();
    const a = doc();
    const b = doc({ id: "u2", file_name: "מכתב.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const { manifest, telemetry } = await preloadExtractedDocuments(store, [a, b], [], 12);

    expect(telemetry.attachment_documents_loaded).toBe(2);
    expect(telemetry.attachment_sources_preloaded).toEqual(["S1", "S2"]);
    expect(manifest.map((m) => m.file_name)).toEqual(["הסכם שכירות.pdf", "מכתב.docx"]);
    const s1 = store.get("S1")!;
    const s2 = store.get("S2")!;
    expect(s1.origin).toBe("user_document");
    expect(s1.url).toBeUndefined();
    expect(s1.user_document?.page_count).toBe(2);
    expect(s2.user_document?.kind).toBe("docx");
    expect(s1.extracted_text).not.toBe(s2.extracted_text.slice(0, 5) + "x");
    // no cross-file concatenation
    expect(store.readable().length).toBe(2);
  });

  it("reports a failed file without discarding the usable ones", async () => {
    const store = new EvidenceStore();
    const ok = doc();
    const bad = { ...doc({ id: "u2", file_name: "broken.pdf" }), error: "pdf: timeout after 15000ms" };
    const { telemetry } = await preloadExtractedDocuments(
      store,
      [ok, bad],
      [{ file_name: "broken.pdf", message: "pdf: timeout after 15000ms" }],
      5,
    );
    expect(telemetry.attachment_documents_loaded).toBe(1);
    expect(telemetry.attachment_extract_errors[0].file_name).toBe("broken.pdf");
  });

  it("serves targeted excerpts from a preloaded document without dumping it", async () => {
    const store = new EvidenceStore();
    await preloadExtractedDocuments(store, [doc()], [], 1);
    const ex = store.excerpt("S1", { find: ["סעיף 14"], maxChars: 300 });
    expect(ex?.windows.join(" ")).toContain("סעיף 14");
    expect(ex!.windows.join(" ").length).toBeLessThan(store.get("S1")!.text_length);
  });

  it("survives pause / serialize / resume", async () => {
    const store = new EvidenceStore();
    await preloadExtractedDocuments(store, [doc()], [], 1);
    const restored = EvidenceStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
    const s1 = restored.get("S1")!;
    expect(s1.origin).toBe("user_document");
    expect(s1.user_document?.page_map.length).toBe(2);
    expect(restored.excerpt("S1", { find: ["סעיף 7"] })?.windows[0]).toContain("סעיף 7");
    // a source appended after resume does not collide with the attachment id
    const next = await restored.append({
      url: "https://example.gov.il/x",
      title: "חוק",
      origin: "web",
      fetch_status: "ok",
      extracted_text: "טקסט".repeat(200),
      is_actual_document: true,
    });
    expect(next.source_id).toBe("S2");
  });
});

describe("agent manifest", () => {
  it("describes files compactly and never dumps the body", async () => {
    const store = new EvidenceStore();
    const { manifest } = await preloadExtractedDocuments(store, [doc()], [], 1);
    const block = buildAttachmentManifest(manifest);
    expect(block).toContain("S1 — הסכם שכירות.pdf");
    expect(block).toContain("2 עמ׳");
    expect(block).toContain("אינו אסמכתה למצב הדין");
    expect(block).toContain("אין חובה לצטט אותו");
    expect(block.length).toBeLessThan(1_200);
    expect(block).not.toContain("research/job");
  });

  it("is empty when nothing was attached", () => {
    expect(buildAttachmentManifest([])).toBe("");
  });

  it("rides on the intake so it survives resume", () => {
    const intake = buildIntake({
      run_id: "r1",
      question: "מה קובע סעיף 7?",
      attachments: [{
        storage_path: `${USER}/research/j/0-a.pdf`,
        file_name: "a.pdf",
        mime_type: "application/pdf",
      }],
      attachment_owner_id: USER,
    });
    expect(intake.attachments?.length).toBe(1);
    expect(intake.attachment_owner_id).toBe(USER);
    expect(attachmentContextBlock(intake)).toBe("");
    intake.attachment_manifest = [{
      source_id: "S1",
      file_name: "a.pdf",
      kind: "pdf",
      page_count: 3,
      head: "פתיח",
      docket_match: false,
      truncated: false,
    }];
    const revived = JSON.parse(JSON.stringify(intake));
    expect(attachmentContextBlock(revived)).toContain("S1 — a.pdf");
  });
});

describe("frontend routing", () => {
  it("sends every normal research request to V2, attachments or not", () => {
    expect(researchFunctionFor({ hasAttachments: true })).toBe(RESEARCH_FUNCTIONS.v2);
    expect(researchFunctionFor({ hasAttachments: false })).toBe(RESEARCH_FUNCTIONS.v2);
    expect(researchFunctionFor()).toBe(RESEARCH_FUNCTIONS.v2);
  });
});
