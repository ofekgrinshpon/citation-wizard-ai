/**
 * Clipboard utility with fallbacks for restricted environments (Word Online iframe).
 */

/** Copy rich text (HTML + plain text) to clipboard with fallbacks. */
export async function copyRichText(html: string, plain: string): Promise<void> {
  // Try modern Clipboard API with rich text
  try {
    const htmlBlob = new Blob([html], { type: "text/html" });
    const textBlob = new Blob([plain], { type: "text/plain" });
    await navigator.clipboard.write([
      new ClipboardItem({ "text/html": htmlBlob, "text/plain": textBlob }),
    ]);
    return;
  } catch {}

  // Try plain text clipboard API
  try {
    await navigator.clipboard.writeText(plain);
    return;
  } catch {}

  // Fallback: execCommand
  execCommandCopy(plain);
}

/** Copy plain text to clipboard with fallbacks. */
export async function copyPlainText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {}

  execCommandCopy(text);
}

function execCommandCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}
