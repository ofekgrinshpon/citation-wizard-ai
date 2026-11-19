// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { copyHomeCitationDemo } from "./homeCitationDemoClipboard";

const docket = "ע״א 6821/93";
const parties = "בנק המזרחי המאוחד בע״מ נ׳ מגדל כפר שיתופי";
const locator = ", פ״ד מט(4) 221, פס׳ 3 לפסק דינו של הנשיא ברק (1995).";
const exactPlain = "ע״א 6821/93 בנק המזרחי המאוחד בע״מ נ׳ מגדל כפר שיתופי, פ״ד מט(4) 221, פס׳ 3 לפסק דינו של הנשיא ברק (1995).";

type ItemData = Record<string, Blob>;
function stubClipboard(write: unknown, writeText: unknown) {
  vi.stubGlobal("navigator", { clipboard: { write, writeText } });
  vi.stubGlobal("ClipboardItem", class MockClipboardItem {
    constructor(public data: ItemData) {}
  });
}
afterEach(() => vi.unstubAllGlobals());

it("writes the exact citation as plain text and RTL HTML with only parties bold", async () => {
  const write = vi.fn();
  const writeText = vi.fn();
  stubClipboard(write, writeText);
  expect(await copyHomeCitationDemo(docket, parties, locator)).toBe("rich");
  const { data } = write.mock.calls[0][0][0];
  expect(await data["text/plain"].text()).toBe(exactPlain);
  expect(await data["text/html"].text()).toBe(`<p dir="rtl" style="direction:rtl;text-align:right;">${docket} <strong>${parties}</strong>${locator}</p>`);
  expect(writeText).not.toHaveBeenCalled();
});

it("honestly falls back to plain when rich clipboard write is denied", async () => {
  const writeText = vi.fn();
  stubClipboard(vi.fn().mockRejectedValue(new Error("rich denied")), writeText);
  expect(await copyHomeCitationDemo(docket, parties, locator)).toBe("plain");
  expect(writeText).toHaveBeenCalledWith(exactPlain);
});

it("rejects when neither format is writable so the UI can offer manual selection", async () => {
  stubClipboard(undefined, vi.fn().mockRejectedValue(new Error("plain denied")));
  await expect(copyHomeCitationDemo(docket, parties, locator)).rejects.toThrow("plain denied");
});
