import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ invoke: vi.fn(), classifier: vi.fn(), cache: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: m.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: m.cache }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: m.classifier } } }));
import { isForeignTreatyText } from "@/lib/foreignTreaty";
import { resolveSourceType } from "@/lib/sourceTypeClassifier";
import { runCitation } from "@/lib/runCitation";
import { detectClassification, engineRouteFor, computeEffective } from "@/lib/foreignClassification";
import { buildPastedCitation, guardPastedCitationRequest } from "../../supabase/functions/_shared/pastedCitation";
import { buildEnginePromptHint } from "@/lib/citationValidation";

const GENEVA = "Geneva Convention Relative to the Protection of Civilian Persons in Time of War";

beforeEach(() => {
  vi.clearAllMocks();
  m.cache.mockResolvedValue(null);
  m.classifier.mockResolvedValue({ data: { sourceType: "treaty", confidence: 0.9, reason: "" }, error: null });
  m.invoke.mockResolvedValue({ data: { content: `${GENEVA}, Aug. 12, 1949, 6 U.S.T. 3516, 75 U.N.T.S. 287.` }, errorInfo: null });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
});

describe("English treaty routing", () => {
  it.each([GENEVA, "geneva convention", "Vienna Convention on the Law of Treaties, May 23, 1969, 1155 U.N.T.S. 331",
    "International Covenant on Civil and Political Rights, Dec. 16, 1966, 999 U.N.T.S. 171", "Charter of the United Nations"])
  ("treaty shape: %s", (raw) => expect(isForeignTreatyText(raw)).toBe(true));

  it.each(["אמנת ז'נבה בדבר הגנת אזרחים בימי מלחמה", "Smith v. Convention Center Corp.", "The Geneva Conventions by Smith, John",
    "Oona Hathaway, Do Human Rights Treaties Make a Difference?, 111 Yale L.J. 1935 (2002)", "Data Protection Act 2018"])
  ("not an English treaty: %s", (raw) => expect(isForeignTreatyText(raw)).toBe(false));

  it("English treaty goes to the foreign route without the classifier", async () => {
    expect(await resolveSourceType(GENEVA)).toEqual({ sourceType: "foreign", source: "regex" });
    expect(m.classifier).not.toHaveBeenCalled();
  });

  it("a Rule 9 treaty verdict on English text becomes a foreign source", async () => {
    const r = await resolveSourceType("Paris Agreement");
    expect(m.classifier).toHaveBeenCalledTimes(1);
    expect(r.sourceType).toBe("foreign");
  });

  it("a Hebrew treaty keeps the Israeli Rule 9 route", async () => {
    expect((await resolveSourceType("אמנת ז'נבה בדבר הגנת אזרחים בימי מלחמה")).sourceType).toBe("treaty");
  });

  it("the English treaty reaches the citation server once, as a foreign source", async () => {
    const r = await runCitation({ rawInput: GENEVA, useVerifiedStore: false });
    expect(m.invoke).toHaveBeenCalledTimes(1);
    expect(r.sourceType).toBe("foreign");
    expect(r.citation).toContain("75 U.N.T.S. 287");
  });

  it("the foreign box detects an English treaty as an international treaty", () => {
    const d = detectClassification(GENEVA);
    expect(d.scalars.subtype?.value).toBe("treaty.agreement");
    expect(engineRouteFor(computeEffective(d, {})).sourceType).toBe("foreign");
  });

  it("U.S.T. treaty series is not U.S. case evidence", () => {
    const c = buildPastedCitation(`${GENEVA}, Aug. 12, 1949, 6 U.S.T. 3516, 75 U.N.T.S. 287`);
    expect(c.evidence.some((e) => e.jurisdiction === "US")).toBe(false);
    expect(c.sourceKind).toBeNull();
  });

  it.each([GENEVA, "אמנת ז'נבה בדבר הגנת אזרחים בימי מלחמה"])("the treaty-type answer line is not treated as conflicting text: %s", (raw) => {
    const prompt = `[סיווג אוטומטי: כתבי אמנה]\n[סוג אמנה: רב-צדדית – "נפתחה לחתימה ב-{שנה}"]\n${buildEnginePromptHint("treaty")}${raw}`;
    const c = guardPastedCitationRequest({ messages: [{ role: "user", content: prompt }], rawInput: raw });
    expect(c.conflicts).toEqual([]);
    expect(c.route).not.toBe("preserve");
  });

  it("the bill-type answer line is not treated as conflicting text", () => {
    const raw = "הצעת חוק הגנת הפרטיות";
    const prompt = `[סיווג אוטומטי: הצעת חוק]\n[סוג חוברת: ה"ח הכנסת]\n${buildEnginePromptHint("bill")}${raw}`;
    expect(guardPastedCitationRequest({ messages: [{ role: "user", content: prompt }], rawInput: raw }).conflicts).toEqual([]);
  });
});
