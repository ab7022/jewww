import { ApiClient, type Me } from "@jev-browser/protocol";
export declare const api: ApiClient;
/** Restore a session after a reload or a Google redirect. True when signed in. */
export declare function restoreSession(): Promise<boolean>;
export declare function authConfig(): Promise<{
    google: boolean;
    dev: boolean;
}>;
export declare function signInWithGoogle(next?: string): void;
export declare function signInDev(email: string): Promise<void>;
export declare function signOut(): Promise<void>;
export type SessionState = {
    status: "loading";
} | {
    status: "signedOut";
} | {
    status: "signedIn";
    me: Me;
    refresh: () => Promise<void>;
};
/** The signed-in person, restored once per page load and shared by every component. */
export declare function useSession(): SessionState;
