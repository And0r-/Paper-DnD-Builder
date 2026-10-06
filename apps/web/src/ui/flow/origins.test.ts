import { evaluateDraft, newDraft } from "@builder/core";
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir } from "@builder/format";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translator } from "../../i18n/index.ts";
import { thingName } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import { originGroups } from "./explain.ts";

const pkg = (await validatePackageDir(DEMO_PACKAGE_DIR)).package!;
const texts: LoadedPackage["texts"] = {};
for (const f of await readdir(join(DEMO_PACKAGE_DIR, "texts", "de"))) {
  const file = JSON.parse(await readFile(join(DEMO_PACKAGE_DIR, "texts", "de", f), "utf8")) as {
    entries: LoadedPackage["texts"];
  };
  Object.assign(texts, file.entries);
}
const { t, list } = translator("de");

function groupsOf(lp: LoadedPackage) {
  const created = newDraft(pkg, 1);
  if (!created.ok) throw new Error("newDraft");
  const doc = { ...created.doc, answers: { calling: { pick: "calling.lantern-bearer" } } };
  return originGroups(lp, evaluateDraft(pkg, doc), { t, list });
}

describe("what you get without choosing", () => {
  it("names two things of the same name from one source once", () => {
    const before = groupsOf({ pkg, lang: "de", texts });
    const calling = before.find((g) => g.from === "calling.lantern-bearer")!;
    expect(calling.things).toEqual(expect.arrayContaining(["item.lantern-staff", "item.provisions"]));
    // A feature that teaches a language of its own name: both are called alike.
    const same = { ...texts, "item.provisions.name": texts["item.lantern-staff.name"]! };
    const lp: LoadedPackage = { pkg, lang: "de", texts: same };
    const names = groupsOf(lp)
      .find((g) => g.from === "calling.lantern-bearer")!
      .things.map((id) => thingName(lp, id));
    expect(names.filter((n) => n === thingName(lp, "item.lantern-staff"))).toHaveLength(1);
    expect(names).toHaveLength(calling.things.length - 1);
  });
});
