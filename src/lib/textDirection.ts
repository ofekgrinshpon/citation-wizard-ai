import { citationTextOnly } from "@/lib/citationSegments";

const HEBREW = /[\u0590-\u05FF\uFB1D-\uFB4F]/;
const LATIN = /[A-Za-z]/;

/**
 * Text direction for one display line: a line with Latin letters and no Hebrew
 * (an English/foreign citation) is left-to-right, so its trailing period and
 * brackets stay in place inside the Hebrew chat. Everything else stays RTL.
 */
/** Hebrew placeholder tags ("[חסר: כרך]") inside an English citation do not make it Hebrew. */
const PLACEHOLDER_TAG = /\[(?:חסר|לא עוצב)[^\]]*\]/gu;

export function lineDirection(line: string): "ltr" | "rtl" {
  const text = citationTextOnly(line).replace(PLACEHOLDER_TAG, " ");
  return LATIN.test(text) && !HEBREW.test(text) ? "ltr" : "rtl";
}
