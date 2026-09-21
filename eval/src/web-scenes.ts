/** Scroll to each landing scene and capture it mid-action: tsx eval/src/web-scenes.ts */
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://localhost:8787";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
for (const [id, wait] of [["do", 7200], ["draft", 5600], ["show", 2600], ["never", 4600], ["talk", 1200], ["pricing", 2200], ["history", 600]] as const) {
  await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({ block: "start" }), id);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `.data/web/scene-${id}.png` });
  console.log(`scene-${id}.png`);
}
await page.goto(base, { waitUntil: "networkidle" });
await page.fill(".omni input", "show me the pricing");
await page.keyboard.press("Enter");
await page.waitForTimeout(700);
await page.screenshot({ path: ".data/web/omni.png" });
console.log("omni.png", errors.length ? `ERRORS ${errors.join(" | ")}` : "");
await browser.close();
