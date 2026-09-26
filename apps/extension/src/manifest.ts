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
  // Pins the extension id (nmkjaahglibmbpdhbchpokcodmbphcna) on every machine and every
  // build, unpacked or not: the server hands sign-in tokens only to ids on its
  // EXTENSION_IDS list, and an unpacked id otherwise depends on the folder it was
  // loaded from. This is the PUBLIC half; the private key is kept outside the repo.
  // When the store listing exists, replace it with the dashboard's public key (the
  // store id then applies) and update EXTENSION_IDS to match.
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAljNrbsozGx67lhZkGS9jWO8dfTlD9EEHTHx7Gk2iDggTf8zI6DnulGcZOP6789PfkGfa6cdtHbjGi/p9oIqr0Rkw9DF8zJhPw+xbex/w1PAK1KytVbP/D2USZUor/Dk+3GA0pxBsKzw2pBu8ONC5MpmO7UApbrplsiE9uDZAtIymiK9Zca5KLcBI/fzGRMF3gC/BRogjiGeytm9vhpDcAT1F/wm03+WAVWlL7cxY8aXzOQf/7ylgW0BDHsHVKPrTQxNT+V0UnX/S+BOo1EATJjuXoJ0b00RW3Dbmi+REA310xmTRXwM70vubwGh3d85AG/jp+9/XHNEYhxLIUwlNVwIDAQAB",
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
  icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
  action: {
    default_title: "Jev Browser Agent",
    default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png" },
  },
}));
