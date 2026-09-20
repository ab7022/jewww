/**
 * Browser-level executor checks that no unit test can cover: following a tab a click
 * opens, and recovering the element after a re-render.
 *
 *   pnpm check:executor
 */
import { CdpExecutor } from "@jev-browser/executor";

// A page whose only control opens a new tab, which is how most "Apply" buttons work.
// Served from a REAL origin: Chromium blocks popups from data: URLs, so testing there
// only proves that Chromium blocks popups.
const ex = await CdpExecutor.launch("https://example.com", { headless: true });
try {
  await ex.inject(
    `document.body.innerHTML =
       '<a href="https://example.com/followed" target="_blank" id="go">Apply</a>'`,
  );
  const before = await ex.snapshot();
  const link = before.elements.find((e) => e.name === "Apply");
  if (!link) throw new Error("collector missed the link");
  const guard = await ex.guardFor(link.node, link.fp);
  await ex.act({ kind: "click", eid: link.eid }, link.node, guard, undefined, link.fp);
  await ex.settle(null, false);
  const after = await ex.snapshot();
  // startsWith, not includes: the data: URL embeds the target href, so `includes`
  // matched the page we had not left.
  const followed = after.url.includes("/followed");
  console.log(`  ${followed ? "ok  " : "FAIL"} executor follows a target=_blank click  (${after.url})`);
  process.exitCode = followed ? 0 : 1;
} finally {
  await ex.close();
}

// A page that replaces its own DOM, as every React app does between a snapshot and
// an action. The fingerprint must find the element again.
const rerender = `data:text/html,${encodeURIComponent(
  `<div id="root"><button id="b">Save profile</button></div>
   <script>
     setTimeout(() => {
       document.getElementById('root').innerHTML =
         '<button id="b2">Save profile</button>';
     }, 300);
   </script>`,
)}`;
const ex2 = await CdpExecutor.launch(rerender, { headless: true });
try {
  const snap = await ex2.snapshot();
  const btn = snap.elements.find((e) => e.name === "Save profile");
  if (!btn) throw new Error("collector missed the button");
  await new Promise((r) => setTimeout(r, 600)); // let the re-render detach it
  const guard = await ex2.guardFor(btn.node, btn.fp);
  let refound = true;
  try {
    await ex2.act({ kind: "click", eid: btn.eid }, btn.node, guard, undefined, btn.fp);
  } catch (err) {
    refound = false;
    console.log(`  FAIL element lost after a re-render: ${(err as Error).message}`);
  }
  if (refound) console.log("  ok   re-finds an element replaced by a re-render");
  if (!refound) process.exitCode = 1;
} finally {
  await ex2.close();
}
