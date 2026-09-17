/**
 * body_only_identity_v1 — authority identity must be BODY-ONLY, CANONICAL and
 * FAIL-CLOSED.
 *
 * These controls deliberately run through the REAL construction path
 * (EvidenceStore.appendUserDocument → body_identity → assessUserDocumentAuthority),
 * not hand-built identity objects: hand-built objects are exactly why the
 * filename-promotion defect survived the previous deterministic suite.
 */

import { describe, expect, it } from "vitest";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import {
  assessUserDocumentAuthority,
  checkIdentity,
} from "../../supabase/functions/legal-research-v2/verification/verify";
import {
  assessPrimaryDocumentDocket,
  detectDocketsInDocumentBody,
} from "../../supabase/functions/legal-research-v2/vendor/docketDetection";
import type { EvidenceSource } from "../../supabase/functions/legal-research-v2/types";

const EXPECTED_RAA = { dockets: ['רע"א 3365/20'], statutes: [] };

const PAD = "פסק דין. ".repeat(80);

/** A genuine-looking first page in NORMAL Hebrew order. */
const NORMAL_HEADER = `בבית המשפט העליון\nרע"א 3365/20\nיוניליוור ישראל נ' בנתאי\n${PAD}`;

/**
 * The real production extraction shape observed from the live Supreme Court
 * PDF (unpdf output): the header tokens arrive reversed, number first.
 */
const REVERSED_HEADER =
  `ןוילעה טפשמה תיבב\n3365/20 א"ער\nיאתנב 'נ לארשי רבוילינוי\n${PAD}`;

async function uploaded(
  store: EvidenceStore,
  opts: { file_name: string; pages: string[] },
): Promise<EvidenceSource> {
  let text = "";
  const pages = opts.pages.map((p, i) => {
    const start = text.length === 0 ? 0 : text.length + 2;
    text += (text ? "\n\n" : "") + p;
    return { page: i + 1, start, end: text.length };
  });
  return await store.appendUserDocument({
    file_name: opts.file_name,
    mime_type: "application/pdf",
    kind: "pdf",
    storage_path: `u/research/tok/0-${opts.file_name}`,
    text,
    pages,
    truncated: false,
    docket_match: false,
    matched_dockets: [],
  });
}

describe("body docket detector", () => {
  it("reads the normal prefix-first form", () => {
    const d = detectDocketsInDocumentBody('רע"א 3365/20 יוניליוור');
    expect(d.refs.map((r) => r.docket_id)).toContain("raa-3365-20");
    expect(d.reversed_used).toBe(false);
  });

  it("reads the reversed Hebrew-PDF form", () => {
    const d = detectDocketsInDocumentBody('3365/20 א"ער');
    expect(d.refs.map((r) => r.docket_id)).toEqual(["raa-3365-20"]);
    expect(d.reversed_used).toBe(true);
  });

  it("generates reversed forms from the prefix table, not one hardcoded case", () => {
    expect(detectDocketsInDocumentBody('9999/11 א"ע').refs[0]?.docket_id).toBe("aa-9999-11");
    expect(detectDocketsInDocumentBody('1/88 ץ"גב').refs[0]?.docket_id).toBe("bagatz-1-88");
  });

  it("never treats a bare number as an identity", () => {
    expect(detectDocketsInDocumentBody("3365/20 בעמוד 4").refs).toHaveLength(0);
  });

  it("confines primary identity to the header zone", () => {
    const body = `${NORMAL_HEADER}`.replace('רע"א 3365/20', 'ע"א 9999/11') +
      "\n\n".padEnd(5_000, "x") + '\nראו רע"א 3365/20 שקבע אחרת';
    const a = assessPrimaryDocumentDocket(body, { identity_zone_chars: 1_200 });
    expect(a.primary_docket_ids).toEqual(["aa:9999/11"]);
    expect(a.body_docket_ids).toContain("raa:3365/20");
  });
});

describe("uploaded authority promotion — critical controls", () => {
  it("A — a filename carrying the expected docket cannot promote", async () => {
    const store = new EvidenceStore();
    const src = await uploaded(store, {
      file_name: "רעא 3365-20 יוניליוור.pdf",
      pages: [NORMAL_HEADER.replace('רע"א 3365/20', 'ע"א 9999/11'), PAD],
    });
    const r = assessUserDocumentAuthority(src, EXPECTED_RAA);
    expect(r.ok).toBe(false);
    expect(r.telemetry.reason).toBe("body_docket_mismatch");
    expect(src.body_identity?.primary_docket_ids).toEqual(["aa:9999/11"]);
  });

  it("B — a genuine body promotes with a generic filename", async () => {
    const store = new EvidenceStore();
    const src = await uploaded(store, { file_name: "document.pdf", pages: [NORMAL_HEADER, PAD] });
    const r = assessUserDocumentAuthority(src, EXPECTED_RAA);
    expect(r.ok).toBe(true);
    expect(r.telemetry.reason).toBe("body_docket_confirmed");
  });

  it("C — a genuine reversed-PDF body promotes", async () => {
    const store = new EvidenceStore();
    const src = await uploaded(store, { file_name: "upload.pdf", pages: [REVERSED_HEADER, PAD] });
    expect(src.body_identity?.primary_docket_ids).toEqual(["raa:3365/20"]);
    const r = assessUserDocumentAuthority(src, EXPECTED_RAA);
    expect(r.ok).toBe(true);
    expect(r.telemetry.reversed_pdf_detected).toBe(true);
  });

  it("D — a wrong filename never overrides a right body", async () => {
    const store = new EvidenceStore();
    const src = await uploaded(store, {
      file_name: "עא 9999-11.pdf",
      pages: [REVERSED_HEADER, PAD],
    });
    expect(assessUserDocumentAuthority(src, EXPECTED_RAA).ok).toBe(true);
  });

  it("E — the same number under a different proceeding type is rejected", async () => {
    const store = new EvidenceStore();
    const src = await uploaded(store, {
      file_name: "document.pdf",
      pages: [NORMAL_HEADER.replace('רע"א 3365/20', 'ע"א 3365/20'), PAD],
    });
    const r = assessUserDocumentAuthority(src, EXPECTED_RAA);
    expect(r.ok).toBe(false);
    expect(r.telemetry.reason).toBe("proceeding_type_mismatch");
  });

  it("F — an incidental citation deep in another judgment is not identity", async () => {
    const store = new EvidenceStore();
    const src = await uploaded(store, {
      file_name: "judgment.pdf",
      pages: [
        NORMAL_HEADER.replace('רע"א 3365/20', 'ע"א 9999/11'),
        `${PAD}\nוראו רע"א 3365/20 יוניליוור נ' בנתאי\n${PAD}`,
      ],
    });
    const r = assessUserDocumentAuthority(src, EXPECTED_RAA);
    expect(r.ok).toBe(false);
    expect(r.telemetry.body_docket_ids).toContain("raa:3365/20");
    expect(r.telemetry.primary_docket_ids).toEqual(["aa:9999/11"]);
  });

  it("G — a reversed incidental citation is likewise not identity", async () => {
    const store = new EvidenceStore();
    const src = await uploaded(store, {
      file_name: "judgment.pdf",
      pages: [
        NORMAL_HEADER.replace('רע"א 3365/20', 'ע"א 9999/11'),
        `${PAD}\n3365/20 א"ער ואר\n${PAD}`,
      ],
    });
    expect(assessUserDocumentAuthority(src, EXPECTED_RAA).ok).toBe(false);
  });

  it("H — no recoverable docket in the body never promotes", async () => {
    const store = new EvidenceStore();
    const src = await uploaded(store, {
      file_name: "רעא 3365-20.pdf",
      pages: [`סיכום פסיקה בנושא ערבות${PAD}`, PAD],
    });
    const r = assessUserDocumentAuthority(src, EXPECTED_RAA);
    expect(r.ok).toBe(false);
    expect(r.telemetry.reason).toBe("no_body_docket");
  });
});

describe("uploaded statute promotion stays body-only", () => {
  const expected = { dockets: [], statutes: [{ statute: "חוק הירושה", section: "25" }] };

  it("rejects a correctly named file whose body is a different statute", async () => {
    const store = new EvidenceStore();
    const src = await uploaded(store, {
      file_name: "חוק הירושה.pdf",
      pages: [`חוק המקרקעין, תשכ"ט-1969\nסעיף 9 לחוק המקרקעין קובע${PAD}`, PAD],
    });
    expect(assessUserDocumentAuthority(src, expected).ok).toBe(false);
  });

  it("accepts a generic filename whose body is the statute", async () => {
    const store = new EvidenceStore();
    const src = await uploaded(store, {
      file_name: "scan.pdf",
      pages: [`סעיף 25 לחוק הירושה, תשכ"ה-1965 קובע${PAD}`, PAD],
    });
    const r = assessUserDocumentAuthority(src, expected);
    expect(r.ok).toBe(true);
    expect(r.telemetry.reason).toBe("body_statute_confirmed");
  });
});

describe("ordinary fetched sources are not title-self-confirming", () => {
  it("rejects a search-result title that claims a docket the body lacks", async () => {
    const store = new EvidenceStore();
    const src = await store.append({
      url: "https://example.org/a",
      title: 'רע"א 3365/20 יוניליוור נ\' בנתאי',
      origin: "web",
      fetch_status: "ok",
      extracted_text: `${PAD}מאמר על ערבות מתמדת${PAD}`,
      is_actual_document: true,
    });
    expect(checkIdentity(src, EXPECTED_RAA).ok).toBe(false);
  });

  it("accepts a genuine fetched judgment whose body carries the docket", async () => {
    const store = new EvidenceStore();
    const src = await store.append({
      url: "https://example.org/b",
      title: 'רע"א 3365/20 יוניליוור נ\' בנתאי',
      origin: "web",
      fetch_status: "ok",
      extracted_text: NORMAL_HEADER,
      is_actual_document: true,
    });
    expect(checkIdentity(src, EXPECTED_RAA).ok).toBe(true);
  });

  it("accepts a genuine fetched judgment extracted in reversed PDF order", async () => {
    const store = new EvidenceStore();
    const src = await store.append({
      url: "https://example.org/c",
      title: 'רע"א 3365/20',
      origin: "web",
      fetch_status: "ok",
      extracted_text: REVERSED_HEADER,
      is_actual_document: true,
    });
    expect(checkIdentity(src, EXPECTED_RAA).ok).toBe(true);
  });
});
