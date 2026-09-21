/**
 * Jev, the character: ONE cursor that lives on the landing page and moves between the
 * sites it is "visiting". Scenes drive it through `agent`; only one scene holds it at a
 * time, and a scene that scrolls out of view gives it up mid-script.
 *
 * Positions are in DOCUMENT coordinates, so it rides along with the page when you scroll
 * instead of hanging in the viewport while the thing it was pointing at slides away.
 */
export interface AgentState {
    x: number;
    y: number;
    label: string;
    mood: "idle" | "busy" | "no" | "point";
    visible: boolean;
    ripple: number;
    ring: {
        x: number;
        y: number;
        w: number;
        h: number;
    } | null;
    /** The path just travelled, drawn as fading dots: motion reads as a move, not a jump. */
    trail: {
        id: number;
        points: {
            x: number;
            y: number;
        }[];
    };
}
export declare const reducedMotion: () => boolean;
export declare class Cancelled extends Error {
}
export interface Script {
    moveTo(el: Element | null, label?: string, at?: "center" | "left"): Promise<void>;
    click(): Promise<void>;
    say(label: string, mood?: AgentState["mood"]): void;
    ring(el: Element | null): void;
    wait(ms: number): Promise<void>;
    type(set: (text: string) => void, text: string, speed?: number): Promise<void>;
    shake(): Promise<void>;
}
/** Take the cursor for a scene. Every step throws `Cancelled` once someone else takes it. */
export declare function take(): Script;
export declare function release(): void;
export declare function useAgent(): AgentState;
/** The cursor itself. Rendered once, at the top of the landing page. */
export declare function Agent(): import("react").JSX.Element;
