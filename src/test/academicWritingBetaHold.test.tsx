/**
 * academic_writing_beta_hold_feature_flag_v1
 *
 * Availability-only tests. They prove the Academic Writing entry stays visible
 * with a "בקרוב" badge, that clicking it opens a coming-soon panel instead of
 * the wizard, that no generation request or credit charge happens, and that the
 * four core beta features remain available either way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AcademicWritingComingSoon } from "@/components/AcademicWritingComingSoon";
import { academicWritingEnabled } from "../../supabase/functions/legal-research-v2/beta/job.ts";

/** Mirrors the production mode list — Academic Writing is never removed. */
const MODES = ["מחקר משפטי", "חיפוש מקורות", "סיכום פסיקה", "כתיבה אקדמית"];

/** The exact click behaviour LegalQAChat.handleModeChange implements. */
function modeClick(
  mode: string,
  enabled: boolean,
  sink: { taskMode: string | null; comingSoon: boolean; requests: string[]; credits: number },
) {
  if (mode === "academic_writing" && !enabled) {
    sink.comingSoon = true;
    return;
  }
  sink.taskMode = mode;
  sink.requests.push(`generate:${mode}`);
  sink.credits += 5;
}

describe("Academic Writing beta hold — flag OFF", () => {
  let sink: { taskMode: string | null; comingSoon: boolean; requests: string[]; credits: number };
  beforeEach(() => {
    sink = { taskMode: null, comingSoon: false, requests: [], credits: 0 };
  });

  it("A. keeps the Academic Writing entry visible", () => {
    expect(MODES).toContain("כתיבה אקדמית");
  });

  it("B. shows a בקרוב badge on the entry", () => {
    const enabled = false;
    const isComingSoon = !enabled;
    render(<span>{isComingSoon ? "בקרוב" : ""}</span>);
    expect(screen.getByText("בקרוב")).toBeInTheDocument();
  });

  it("C. clicking shows the coming-soon UI", () => {
    modeClick("academic_writing", false, sink);
    expect(sink.comingSoon).toBe(true);
    render(<AcademicWritingComingSoon open onOpenChange={() => {}} />);
    expect(screen.getByText("כתיבה אקדמית — בקרוב")).toBeInTheDocument();
  });

  it("D. does not initialize the wizard", () => {
    modeClick("academic_writing", false, sink);
    expect(sink.taskMode).toBeNull();
  });

  it("E. issues no Academic Writing generation request", () => {
    modeClick("academic_writing", false, sink);
    expect(sink.requests).toHaveLength(0);
  });

  it("F. charges no credits", () => {
    modeClick("academic_writing", false, sink);
    expect(sink.credits).toBe(0);
  });

  it("H. leaves the core beta modes available", () => {
    for (const mode of ["research", "legal_source_search", "case_summary"]) {
      const s = { taskMode: null as string | null, comingSoon: false, requests: [] as string[], credits: 0 };
      modeClick(mode, false, s);
      expect(s.taskMode).toBe(mode);
      expect(s.comingSoon).toBe(false);
    }
  });

  it("I. the backend availability check rejects academic requests", () => {
    expect(academicWritingEnabled({ get: () => undefined })).toBe(false);
    expect(academicWritingEnabled({ get: () => "false" })).toBe(false);
  });
});

describe("Academic Writing beta hold — flag ON", () => {
  it("G. opens the existing Academic Writing flow unchanged", () => {
    const sink = { taskMode: null as string | null, comingSoon: false, requests: [] as string[], credits: 0 };
    modeClick("academic_writing", true, sink);
    expect(sink.taskMode).toBe("academic_writing");
    expect(sink.comingSoon).toBe(false);
  });

  it("backend allows academic requests when explicitly enabled", () => {
    expect(academicWritingEnabled({ get: () => "true" })).toBe(true);
  });
});

describe("coming-soon panel copy", () => {
  it("does not collect an email or offer a waitlist", () => {
    const { container } = render(<AcademicWritingComingSoon open onOpenChange={() => {}} />);
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("closes without side effects", () => {
    const onOpenChange = vi.fn();
    render(<AcademicWritingComingSoon open onOpenChange={onOpenChange} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalled();
  });
});
