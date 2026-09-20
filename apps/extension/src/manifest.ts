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
export default defineManifest({
  manifest_version: 3,
  name: "Jev Browser Agent",
  version: "0.1.0",
  description: "Give it a goal. It does the browsing. You approve anything irreversible.",
  permissions: ["storage", "tabs", "scripting", "sidePanel", "alarms", "identity"],
  optional_permissions: ["debugger"],
  host_permissions: [],
  optional_host_permissions: ["https://*/*"],
  background: { service_worker: "src/background/index.ts", type: "module" },
  content_scripts: [
    {
      matches: ["https://*/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  side_panel: { default_path: "src/sidepanel/index.html" },
  action: { default_title: "Jev Browser Agent" },
});
