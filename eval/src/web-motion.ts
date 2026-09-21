/** Captures the motion-pass sections: tsx eval/src/web-motion.ts */
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://localhost:8787";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(4200);
await page.screenshot({ path: ".data/web/m-hero.png" });
const at = async (sel: string, name: string, wait: number, offset = -120) => {
  await page.evaluate(([s, o]) => { const el = document.querySelector(s as string); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + scrollY + (o as number), behavior: "instant" }); }, [sel, offset]);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `.data/web/${name}.png` });
};
await at(".marquee", "m-marquee", 800, -520);
await at("#do", "m-chapter", 6500, -150);
await at(".proof", "m-proof", 1800, -300);
await at(".wall", "m-wall", 1200, -60);
console.log(errors.length ? `ERRORS ${errors.join(" | ")}` : "ok");
await browser.close();
