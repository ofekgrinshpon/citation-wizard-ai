import { useLayoutEffect, useRef, type ReactNode } from "react";
import { WordFootnoteWorkflow } from "./WordFootnoteWorkflow";
import type { CitationSourceQuota } from "@/lib/citationTrialQuota";

/** Footnotes tab: goes straight to the Word document review (no manual entry). */
export function FootnotesSection({ sourceQuota, active = true }: { sourceQuota?: CitationSourceQuota; active?: boolean } = {}) {
  return (
    <div className="py-6" style={{ direction: "rtl" }}>
      <p className="text-muted-foreground text-xs mb-3">
        ReLex הוא AI ויכול לעשות טעויות. יש לבדוק שנית את הפלט לפני השימוש בו.
      </p>
      <WordFootnoteWorkflow sourceQuota={sourceQuota} active={active} />
    </div>
  );
}

/** Remains mounted for the current account/project, with its own scroll position. */
export function WordFootnotePane({ active, sourceQuota, children }: {
  active: boolean; sourceQuota?: CitationSourceQuota; children?: ReactNode;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  useLayoutEffect(() => {
    if (active && pane.current) pane.current.scrollTop = scrollTop.current;
  }, [active]);
  return (
    <div ref={pane} hidden={!active}
      onScroll={e => { if (active) scrollTop.current = e.currentTarget.scrollTop; }}
      className="flex-1 overflow-y-auto px-3 sm:px-4"
      style={{ maxWidth: 860, margin: "0 auto", width: "100%" }}>
      {active && children}
      <FootnotesSection sourceQuota={sourceQuota} active={active} />
    </div>
  );
}

export default FootnotesSection;
