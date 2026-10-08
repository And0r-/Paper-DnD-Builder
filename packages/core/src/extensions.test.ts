import { describe, expect, it } from "vitest";
import { answersFromExtension } from "./extensions.ts";

const ext = { things: ["path.tide-warden", "talent.tide-reading"], choices: ["tide-song"] };

describe("answersFromExtension", () => {
  it("names the choices whose answers come from the extension", () => {
    expect(
      answersFromExtension(ext, {
        path: { pick: "path.tide-warden" },
        "talents-river-runner": { picks: ["talent.climbing", "talent.tide-reading"] },
        "tide-song": { text: "la" },
        "boon-raise@path.tide-warden": { method: 0, assign: {} },
        "tide-song@boon-4": { text: "x" },
        calling: { pick: "calling.river-runner" },
        name: { text: "Mira" },
      }),
    ).toEqual([
      "path",
      "talents-river-runner",
      "tide-song",
      "boon-raise@path.tide-warden",
      "tide-song@boon-4",
    ]);
  });

  it("finds nothing in a character without it", () => {
    expect(
      answersFromExtension(ext, {
        calling: { pick: "calling.river-runner" },
        talents: { picks: ["talent.climbing"] },
      }),
    ).toEqual([]);
  });
});
