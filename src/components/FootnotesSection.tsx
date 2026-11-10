import { WordFootnoteWorkflow } from "./WordFootnoteWorkflow";

/** Footnotes tab: goes straight to the Word document review (no manual entry). */
export function FootnotesSection() {
  return (
    <div className="py-6" style={{ direction: "rtl" }}>
      <p className="text-muted-foreground text-xs mb-3">
        ReLex הוא AI ויכול לעשות טעויות. יש לבדוק שנית את הפלט לפני השימוש בו.
      </p>
      <WordFootnoteWorkflow />
    </div>
  );
}

export default FootnotesSection;
