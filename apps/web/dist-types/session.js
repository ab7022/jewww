import { ApiClient } from "@jev-browser/protocol";
import { useEffect, useState } from "react";
/**
 * The website's session.
 *
 * The access token lives in memory only. The refresh token is an httpOnly cookie the
 * server sets, so no script on the page — ours or an injected one — can read a
 * long-lived credential. A reload loses the access token and silently gets a new one
 * from the cookie.
 *
 * Every API call goes through the same typed client the extension uses, generated from
 * the server's own endpoint table, so the website cannot drift from the server either.
 */
let memory = null;
const listeners = new Set();
const notify = () => {
    for (const l of listeners)
        l();
};
const store = {
    async get() {
        return memory;
    },
    async set(tokens) {
        memory = tokens;
        notify();
    },
};
export const api = new ApiClient("", store);
async function postAuth(path, body) {
    return fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}
/** Restore a session after a reload or a Google redirect. True when signed in. */
export async function restoreSession() {
    // Back from Google: the access token arrives in the fragment, which never reaches a
    // server log. Take it and remove it from the address bar straight away.
    const fragment = new URLSearchParams(location.hash.slice(1));
    const access = fragment.get("access");
    if (access) {
        history.replaceState(null, "", location.pathname + location.search);
        await store.set({ access, refresh: "" });
        return true;
    }
    // Only when there has been a sign-in: the refresh cookie is httpOnly, so the page
    // reads a harmless marker the server sets beside it.
    if (!document.cookie.split("; ").includes("jev_signed_in=1"))
        return false;
    const res = await postAuth("/auth/refresh", {}).catch(() => null);
    if (!res?.ok)
        return false;
    const body = (await res.json());
    await store.set({ access: body.access, refresh: "" });
    return true;
}
export async function authConfig() {
    const res = await fetch("/auth/config").catch(() => null);
    if (!res?.ok)
        return { google: false, dev: false };
    return (await res.json());
}
export function signInWithGoogle(next = "/dashboard") {
    location.href = `/auth/google/start?redirect=${encodeURIComponent(location.origin + next)}`;
}
export async function signInDev(email) {
    const res = await postAuth("/auth/dev", { email, client: "web" });
    if (!res.ok)
        throw new Error("Development sign-in is not available on this server.");
    const body = (await res.json());
    await store.set({ access: body.access, refresh: "" });
}
export async function signOut() {
    await postAuth("/auth/logout", {}).catch(() => null);
    await store.set(null);
}
let restoring = null;
/** The signed-in person, restored once per page load and shared by every component. */
export function useSession() {
    const [state, setState] = useState({ status: "loading" });
    useEffect(() => {
        let alive = true;
        const load = async () => {
            restoring ??= restoreSession();
            const ok = memory ? true : await restoring;
            if (!alive)
                return;
            if (!ok || !memory) {
                setState({ status: "signedOut" });
                return;
            }
            try {
                const me = await api.call("me");
                if (alive)
                    setState({ status: "signedIn", me, refresh: load });
            }
            catch {
                if (alive)
                    setState({ status: "signedOut" });
            }
        };
        void load();
        listeners.add(load);
        return () => {
            alive = false;
            listeners.delete(load);
        };
    }, []);
    return state;
}
//# sourceMappingURL=session.js.map