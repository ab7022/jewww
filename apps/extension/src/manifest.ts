import { defineManifest } from "@crxjs/vite-plugin";

/**
 * Deliberately minimal permissions.
 *
 * `host_permissions` is EMPTY at install. A browser agent that ships with
 * `https://*` already granted is a standing keylogger on every site the user visits;
 * we request each origin when a run actually needs it, which also gives the user a
 * natural consent point and makes store review survivable.
 *
 * `debugger` is optional and requested only for file upload, which cannot be done
 * from page JS at all — it needs DOM.setFileInputFiles over CDP.
 */
/**
 * The test build (`vite build --mode test`, used only by the conformance gauntlet)
 * differs in exactly one way: it is granted the local fixture origin up front, because
 * a permission prompt needs a human to click it. The shipped manifest is untouched, and
 * the load check asserts its host permissions are still empty.
 */
export default defineManifest((env) => ({
  manifest_version: 3,
  name: "Jev Browser Agent",
  version: "0.1.0",
  description: "Give it a goal. It does the browsing. You approve anything irreversible.",
  permissions: ["storage", "tabs", "scripting", "sidePanel", "alarms", "identity"],
  optional_permissions: ["debugger"],
  host_permissions: env.mode === "test" ? ["http://127.0.0.1/*"] : [],
  // http as well as https: intranet tools, admin panels and local dev servers are
  // plain http, and the extension used to fail on them with "Receiving end does not
  // exist" — its content script's module was web-accessible to https pages only.
  // Still opt-in per origin: nothing is granted until a run asks for it.
  optional_host_permissions: ["https://*/*", "http://*/*"],
  background: { service_worker: "src/background/index.ts", type: "module" },
  content_scripts: [
    {
      matches: ["https://*/*", "http://*/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  side_panel: { default_path: "src/sidepanel/index.html" },
  // ⌥J opens Jev. A keyboard command counts as a user gesture, which is what Chrome
  // requires before it will open a side panel — a voice alone cannot.
  commands: {
    _execute_action: {
      suggested_key: { default: "Alt+J", mac: "Alt+J" },
      description: "Open Jev",
    },
  },
  action: { default_title: "Jev Browser Agent" },
}));
