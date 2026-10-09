import { describe, expect, it } from "vitest";
import { hrefOfStep, stepOfPath } from "./where.ts";

describe("where someone is on a character", () => {
  it("reads the screen from the path", () => {
    expect(stepOfPath("/c/abc/step/folk")).toBe("folk");
    expect(stepOfPath("/c/abc/step/boon-raise%40boon-8")).toBe("boon-raise@boon-8");
    expect(stepOfPath("/c/abc/overview")).toBe("overview");
    expect(stepOfPath("/c/abc/campaign")).toBe("@campaign");
    expect(stepOfPath("/c/abc/done")).toBe("done");
    expect(stepOfPath("/characters")).toBeNull();
  });

  it("leads back to the screen, never to the owner's sheet", () => {
    expect(hrefOfStep("abc", "folk")).toBe("/c/abc/step/folk");
    expect(hrefOfStep("abc", "overview")).toBe("/c/abc/overview");
    expect(hrefOfStep("abc", "raise")).toBe("/c/abc/raise");
    expect(hrefOfStep("abc", "bogen")).toBeNull();
  });
});
