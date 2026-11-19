/** Local homepage demo only. Let the caller announce the format actually written. */
export async function copyHomeCitationDemo(
  docket: string,
  parties: string,
  locator: string,
): Promise<"rich" | "plain"> {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const plain = `${docket} ${parties}${locator}`;
  const html = `<p dir="rtl" style="direction:rtl;text-align:right;">${escape(docket)} <strong>${escape(parties)}</strong>${escape(locator)}</p>`;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
    return "rich";
  } catch {
    // Older browsers and stricter clipboard permissions may only allow plain text.
    // If this rejects too, the caller offers manual selection, not success.
    await navigator.clipboard.writeText(plain);
    return "plain";
  }
}
