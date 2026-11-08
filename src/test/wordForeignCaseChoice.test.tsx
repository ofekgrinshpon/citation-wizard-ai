/**
 * Word review cards: record-bound choice between foreign rulings/reports,
 * and a user-typed decision year that survives an unverified lookup.
 * Mocked search only.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { CHAT_HOST, RUNNER_HOST, WORD_HOST, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse } from "@/lib/citationPlanner";
import { citationTextOnly } from "@/lib/citationSegments";
import { WordFootnoteWorkflow } from "../components/WordFootnoteWorkflow";

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), check: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/docxFootnoteRoundtrip", () => ({ inspectDocxFootnotes: mocks.inspect, embedStyledFootnotes: vi.fn(), checkStyledFootnote: mocks.check, checkStyledFootnotes: vi.fn() }));
vi.mock("@/lib/runCitation", () => ({ runCitation: mocks.run }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "a" } }) }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ currentProject: { id: "p" } }) }));
vi.mock("@/lib/costTelemetry", () => ({ newTelemetryBatch: () => ({}), sourceTelemetry: () => ({}) }));
vi.mock("../components/CitationRequestStatusLink", () => ({ CitationRequestStatusLink: () => null }));

interface Item { title: string; url: string; snippet: string }
const DONOGHUE = { title: "Donoghue v Stevenson [1932] UKHL 100 (26 May 1932)", url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html", snippet: "Donoghue v Stevenson [1932] UKHL 100, [1932] AC 562, 1932 SC (HL) 31." };
const JOGEE = { title: "R v Jogee [2016] UKSC 8 (18 February 2016)", url: "https://www.bailii.org/uk/cases/UKSC/2016/8.html", snippet: "R v Jogee [2016] UKSC 8, [2017] AC 387." };
const JOGEE_UNVERIFIED = { title: "R v Jogee", url: "https://www.supremecourt.uk/cases/uksc-2015-0015.html", snippet: "R v Jogee; Ruddock v The Queen [2016] UKPC 7" };

const planFor = (input: string) => {
  const evidence = planCitationEvidence(input, null);
  const p = { evidence, sourceType: null, input, isPinpoint: false, manual: false };
  const local = planLocalCitation(p, RUNNER_HOST);
  return planTypedRequest({ ...p, statutePrep: "statutePrep" in local ? local.statutePrep : null, canonicalRaw: input }, RUNNER_HOST);
};
async function lookup(input: string, items: Item[]) {
  const plan = planFor(input);
  const fetchImpl = (async (url: unknown) => String(url).includes("perplexity.ai")
    ? new Response(JSON.stringify({ results: items }), { status: 200 }) : new Response("nf", { status: 404 })) as unknown as typeof fetch;
  const response = await runForeignLookup({ ...plan.foreignLookup!, rawInput: input } as ForeignLookupInput, { fetchImpl, apiKey: "offline-only" });
  return { plan, data: { foreignLookup: response } as Record<string, unknown> };
}
const terminal = (r: ReturnType<typeof resolveCitationResponse>) => { if (r.kind !== "terminal") throw new Error("not terminal"); return r; };

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); })); mocks.check.mockResolvedValue(null); });

describe("a decision year the user typed is kept", () => {
  it("R v Jogee [2016]: an unverified neutral citation keeps the year instead of dropping it", async () => {
    const { plan, data } = await lookup("R v Jogee [2016]", [JOGEE_UNVERIFIED]);
    expect(citationTextOnly(terminal(resolveCitationResponse(plan, data, RUNNER_HOST)).resolution.citation)).toBe("R v Jogee [2016].");
  });
  it("R v Jogee [2016]: a verified neutral citation is shown with its year", async () => {
    const { plan, data } = await lookup("R v Jogee [2016]", [JOGEE]);
    expect(citationTextOnly(terminal(resolveCitationResponse(plan, data, RUNNER_HOST)).resolution.citation)).toBe("R v Jogee [2016] UKSC 8, [2017] AC 387.");
  });
  it("R v Jogee (2016): a round-bracket year is kept too", async () => {
    const { plan, data } = await lookup("R v Jogee (2016)", [JOGEE_UNVERIFIED]);
    expect(citationTextOnly(terminal(resolveCitationResponse(plan, data, RUNNER_HOST)).resolution.citation)).toBe("R v Jogee [2016].");
  });
});

describe("choice buttons in the Word review", () => {
  it("the Word host gets a record-bound choice; batch/bibliography still do not", async () => {
    const { plan, data } = await lookup("Donoghue v Stevenson", [DONOGHUE]);
    expect(terminal(resolveCitationResponse(plan, data, WORD_HOST)).resolution.foreignChoice?.stage).toBe("location");
    expect(terminal(resolveCitationResponse(plan, data, RUNNER_HOST)).resolution.foreignChoice).toBeUndefined();
    expect(terminal(resolveCitationResponse(plan, data, CHAT_HOST)).resolution.foreignChoice?.stage).toBe("location");
  });

  it("choosing [1932] AC 562 fills the proposed correction without another request", async () => {
    const input = "Donoghue v Stevenson";
    const { plan, data } = await lookup(input, [DONOGHUE]);
    const resolution = terminal(resolveCitationResponse(plan, data, WORD_HOST)).resolution;
    mocks.run.mockResolvedValue({ ...resolution, sourceType: "foreign_case_other", sourceLabel: "x", fromVerifiedStore: false });
    mocks.inspect.mockResolvedValue({ notes: [{ id: "1", text: input, editableRanges: [{ start: 0, end: input.length }], paragraphRanges: [{ start: 0, end: input.length }] }], skippedNotes: [] });
    render(<WordFootnoteWorkflow />);
    const f = new File(["x"], "paper.docx"); Object.defineProperty(f, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
    fireEvent.change(screen.getByLabelText("מסמך DOCX"), { target: { files: [f] } });
    await screen.findByText("paper.docx");
    fireEvent.click(screen.getByRole("button", { name: "המשך לבדיקת ההערות" }));
    fireEvent.click(screen.getByRole("button", { name: /^בדוק \d+ מקורות$/ }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    expect(mocks.run.mock.calls[0][0]).toMatchObject({ recordChoices: true });
    const option = await screen.findByRole("button", { name: "1. [1932] AC 562" });
    // A pending choice is not sent again by the batch button.
    expect(screen.getByRole("button", { name: "אין הערות נוספות לבדיקה" })).toBeDisabled();
    fireEvent.click(option);
    await waitFor(() => expect(screen.getByLabelText("התיקון המוצע לאזכור 1")).toHaveValue("Donoghue v Stevenson [1932] AC 562."));
    expect(screen.queryByRole("button", { name: "2. 1932 SC (HL) 31" })).not.toBeInTheDocument();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
});
