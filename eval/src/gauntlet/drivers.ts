import { createReadStream, existsSync, mkdtempSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpExecutor } from "@jev-browser/executor";
import {
  type Action,
  type Executor,
  type Guard,
  type RawSnapshot,
  StalePage,
  UnreachableTarget,
} from "@jev-browser/shared";
import { type BrowserContext, chromium, type Page, type Worker } from "playwright";

/**
 * The two implementations of `Executor`, behind one interface, so the SAME scenario
 * code runs against both.
 *
 * This is the guard for the class of bug that produced most of the live failures:
 * the CDP driver and the extension implemented one contract and diverged wherever the
 * interface did not describe behaviour — a real mouse versus `el.click()`, following a
 * new tab versus staying put, a live URL versus a cached "". A scenario that passes on
 * one and fails on the other is exactly that drift, caught before a user finds it.
 */
export interface Session {
  exec: Executor;
  /** Evaluate in whatever page the executor is currently driving. */
  probe(expression: string): Promise<unknown>;
  close(): Promise<void>;
}

export interface Driver {
  name: string;
  open(url: string): Promise<Session>;
  shutdown(): Promise<void>;
}

// --- fixtures -------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const PAGES = join(here, "../../gauntlet/pages");
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

/** Serve the fixture pages on 127.0.0.1 — the origin the extension's test build is granted. */
/** What fixture apps reported — the ground truth the agent cases are graded on. */
export const fixtureEvents: Record<string, unknown>[] = [];

export async function serveFixtures(): Promise<{ base: string; server: Server }> {
  const server = createServer((req, res) => {
    if (req.url === "/__event" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          fixtureEvents.push(JSON.parse(body) as Record<string, unknown>);
        } catch {
          // ignore malformed
        }
        res.writeHead(204).end();
      });
      return;
    }
    const path = join(PAGES, decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/"));
    if (!path.startsWith(PAGES) || !existsSync(path) || statSync(path).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, server };
}

// --- CDP ------------------------------------------------------------------------

export function cdpDriver(): Driver {
  return {
    name: "cdp",
    async open(url) {
      const exec = await CdpExecutor.launch(url, { headless: true });
      return { exec, probe: (e) => exec.probe(e), close: () => exec.close() };
    },
    async shutdown() {},
  };
}

// --- extension ------------------------------------------------------------------

/**
 * The real extension, loaded unpacked into Chromium, driven through the real
 * `TabExecutor` running in its service worker. Every call crosses the same boundaries
 * a production run does: worker → content script → page.
 */
export async function extensionDriver(): Promise<Driver> {
  const dist = join(here, "../../../apps/extension/dist-test");
  if (!existsSync(join(dist, "manifest.json"))) {
    throw new Error("build the test extension first: pnpm --filter @jev-browser/extension build:test");
  }
  const context: BrowserContext = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), "jev-gauntlet-")),
    {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    },
  );
  const worker: Worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15_000 }));

  let seq = 0;
  return {
    name: "extension",
    async open(url) {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const handle = `exec${++seq}`;
      const tabUrl = page.url();
      const attached = (await worker.evaluate(
        async ({ handle, tabUrl }) => {
          const g = globalThis as unknown as Record<string, unknown> & {
            __jevTest: { TabExecutor: new (id: number) => { ensureContentScript(): Promise<void> } };
            chrome: { tabs: { query(q: object): Promise<{ id?: number; url?: string }[]> } };
          };
          const tabs = await g.chrome.tabs.query({});
          const tab = tabs.find((t) => t.url === tabUrl);
          if (!tab?.id) return `no tab for ${tabUrl}`;
          const exec = new g.__jevTest.TabExecutor(tab.id);
          g[handle] = exec;
          try {
            await exec.ensureContentScript();
            return null;
          } catch (err) {
            return String(err);
          }
        },
        { handle, tabUrl },
      )) as string | null;
      if (attached) throw new Error(`could not attach the extension executor: ${attached}`);

      const exec = new RemoteExecutor(worker, handle);
      return {
        exec,
        async probe(expression) {
          const current = await exec.url();
          const target = context.pages().find((p) => p.url() === current) ?? page;
          return target.evaluate(expression);
        },
        async close() {
          for (const p of context.pages()) if (p !== page) await p.close().catch(() => {});
          await page.close().catch(() => {});
        },
      };
    },
    async shutdown() {
      await context.close();
    },
  };
}

/** Forwards every Executor call to a TabExecutor living in the service worker. */
class RemoteExecutor implements Executor {
  constructor(
    private readonly worker: Worker,
    private readonly handle: string,
  ) {}

  private async call<T>(method: string, args: unknown[]): Promise<T> {
    const r = (await this.worker.evaluate(
      async ({ handle, method, args }) => {
        const exec = (globalThis as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[handle];
        try {
          return { ok: true, value: await exec?.[method]?.(...args) };
        } catch (err) {
          const e = err as Error;
          return { ok: false, name: e.name, message: e.message };
        }
      },
      { handle: this.handle, method, args },
    )) as { ok: true; value: T } | { ok: false; name: string; message: string };
    if (r.ok) return r.value;
    if (r.name === "StalePage") throw new StalePage(r.message);
    if (r.name === "UnreachableTarget") throw new UnreachableTarget(r.message);
    throw new Error(r.message);
  }

  snapshot(): Promise<RawSnapshot> {
    return this.call("snapshot", []);
  }
  pageText(maxChars?: number): Promise<string> {
    return this.call("pageText", maxChars === undefined ? [] : [maxChars]);
  }
  guardFor(node: number | null, fp?: string): Promise<Guard> {
    return this.call("guardFor", fp === undefined ? [node] : [node, fp]);
  }
  act(action: Action, node: number | null, guard: Guard, text?: string, fp?: string): Promise<void> {
    return this.call("act", [action, node, guard, text, fp]);
  }
  preflight(action: Action, node: number | null, fp?: string): Promise<string | null> {
    return this.call("preflight", fp === undefined ? [action, node] : [action, node, fp]);
  }
  point(node: number, message: string, fp?: string): Promise<string | null> {
    return this.call("point", fp === undefined ? [node, message] : [node, message, fp]);
  }
  settle(node: number | null, isCombobox: boolean): Promise<void> {
    return this.call("settle", [node, isCombobox]);
  }
  url(): Promise<string> {
    return this.call("url", []);
  }
  close(): Promise<void> {
    return this.call("close", []);
  }
}

export type { Page };
