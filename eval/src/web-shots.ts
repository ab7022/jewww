/** Screenshots of the website for review: tsx eval/src/web-shots.ts [base] */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:8787";
const browser = await chromium.launch();
const shoot = async (name: string, path: string, opts: { width: number; height: number; dark?: boolean; full?: boolean; wait?: number; before?: (p: import("playwright").Page) => Promise<void> }) => {
  const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, colorScheme: opts.dark ? "dark" : "light", deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await opts.before?.(page);
  await page.waitForTimeout(opts.wait ?? 400);
  await page.screenshot({ path: `.data/web/${name}.png`, fullPage: opts.full ?? false });
  console.log(`${name}.png${errors.length ? `  ERRORS: ${errors.join(" | ")}` : ""}`);
  await page.close();
};
await shoot("landing-hero", "/", { width: 1280, height: 860, wait: 5200 });
await shoot("landing-full", "/", { width: 1280, height: 860, full: true, wait: 800 });
await shoot("landing-dark", "/", { width: 1280, height: 860, dark: true, wait: 9500 });
await shoot("landing-mobile", "/", { width: 390, height: 844, full: true, wait: 800 });
await shoot("signin", "/signin", { width: 1280, height: 800 });
await shoot("dashboard", "/signin", {
  width: 1280, height: 900, full: true, wait: 1500,
  before: async (p) => { await p.getByRole("button", { name: /Sign in for development/ }).click(); await p.waitForURL("**/dashboard"); },
});
await browser.close();
