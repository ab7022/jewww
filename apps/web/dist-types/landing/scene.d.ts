import { type ReactNode, type RefObject } from "react";
import { type Script } from "./agent.js";
/**
 * Hand Jev the cursor while a scene is on screen, and loop its script there.
 * Scrolling a scene out of view does not stop it by itself — the next scene to arrive
 * takes the cursor, which cancels the previous script mid-step.
 */
export declare function useScene(ref: RefObject<HTMLElement | null>, script: (s: Script) => Promise<void>, reset: () => void): void;
/** A page Jev is visiting: its own address, its own look. */
export declare function Site({ url, tone, children, id, }: {
    url: string;
    tone: string;
    children: ReactNode;
    id?: string;
}): import("react").JSX.Element;
/** What the person asked, in their own words, as a speech bubble. */
export declare function Asked({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
