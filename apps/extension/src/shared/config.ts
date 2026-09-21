/**
 * Which server this build of the extension talks to — decided once, at build time,
 * from the build's MODE, and read by the worker and the panel alike.
 *
 * The default used to be localhost for every build, so the extension anyone actually
 * installed tried to reach the developer's laptop and the panel said so in hardcoded
 * text. Now a production build talks to production; `vite` dev and the test build
 * talk to localhost; VITE_API_BASE overrides either.
 */
export const LIVE_API = "https://jev-olive.vercel.app";

export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? (import.meta.env.MODE === "production" ? LIVE_API : "http://localhost:8787");

/** "jev-olive.vercel.app" — for telling a person which server could not be reached. */
export const API_HOST = new URL(API_BASE).host;
