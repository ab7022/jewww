import { describe, expect, it } from "vitest";
import { matchWake } from "../src/sidepanel/wake.js";

describe("hearing “Hey Jev”", () => {
  it("wakes on the phrase and keeps the request said in the same breath", () => {
    expect(matchWake("hey jev open amplify and check prod status")).toEqual({
      woke: true,
      rest: "Open amplify and check prod status",
    });
  });

  it("wakes on what recognisers actually hear for “Jev”", () => {
    for (const heard of ["Hey Jeff", "hi Jeb", "okay chef", "Hey, Jev!", "hey jove"]) {
      expect(matchWake(heard).woke, heard).toBe(true);
    }
  });

  it("wakes with nothing after it, so the next sentence is the request", () => {
    expect(matchWake("Hey Jeff.")).toEqual({ woke: true, rest: "" });
  });

  it("finds the phrase mid-transcript, where continuous recognition leaves it", () => {
    expect(matchWake("so anyway hey jev draft a reply").rest).toBe("Draft a reply");
  });

  it("drops the politeness a spoken request starts with", () => {
    expect(matchWake("hey jev can you summarise this page").rest).toBe("Summarise this page");
  });

  it("does not wake on the name alone, or on words that merely contain it", () => {
    for (const heard of ["jeff said the build is green", "the chef is here", "they jeopardised it", "hey jefferson", "a chef recommended it"]) {
      expect(matchWake(heard).woke, heard).toBe(false);
    }
  });
});
