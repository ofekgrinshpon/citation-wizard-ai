import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition, openBrowser, renderStill } from "@remotion/renderer";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] || "main";
const out = process.argv[3] || `/mnt/documents/relex-promo.mp4`;
const stillFrame = process.argv[4];

const bundled = await bundle({
  entryPoint: path.resolve(__dirname, "../src/index.ts"),
  webpackOverride: (c) => c,
});

const browser = await openBrowser("chrome", {
  browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH ?? "/bin/chromium",
  chromiumOptions: { args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] },
  chromeMode: "chrome-for-testing",
});

const composition = await selectComposition({ serveUrl: bundled, id: mode, puppeteerInstance: browser });

if (stillFrame) {
  await renderStill({
    composition,
    serveUrl: bundled,
    output: out,
    frame: parseInt(stillFrame, 10),
    puppeteerInstance: browser,
  });
  console.log("still:", out, "frame", stillFrame);
} else {
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: out,
    puppeteerInstance: browser,
    muted: true,
    concurrency: 1,
  });
  console.log("rendered:", out);
}

await browser.close({ silent: false });
process.exit(0);
