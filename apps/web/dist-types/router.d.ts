import { type AnchorHTMLAttributes } from "react";
export declare function navigate(to: string): void;
export declare function usePath(): string;
/** An <a> that navigates in-page for local paths, and behaves normally otherwise. */
export declare function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>): import("react").JSX.Element;
