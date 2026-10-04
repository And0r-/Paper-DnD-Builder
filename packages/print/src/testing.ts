/**
 * Test support: a finished demo character, built the way a player who
 * takes every recommendation would build it. Only imported by tests and
 * the sample script.
 */
import { applyChange, evaluateDraft, newDraft, type ChoiceState, type DraftDocument } from "@builder/core";
import type { ContentPackage } from "@builder/format";
import { validatePackageDir } from "@builder/format";
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";

export async function loadDemoPackage(): Promise<ContentPackage> {
  const result = await validatePackageDir(DEMO_PACKAGE_DIR);
  if (!result.package) throw new Error("demo package does not validate");
  return result.package;
}

function answerFor(c: ChoiceState, name: string): unknown {
  switch (c.kind) {
    case "pickOne":
      return { pick: (c.recommended as string[] | undefined)?.[0] ?? c.options![0] };
    case "pickMany": {
      const rec = (c.recommended as string[] | undefined) ?? [];
      return { picks: rec.length === c.count ? rec : c.options!.slice(0, c.count) };
    }
    case "distribute":
      return c.recommended;
    case "number":
      return { value: c.min };
    case "text":
      return { text: name };
    case "info":
      return null;
  }
}

/** A complete character at `level`, every open choice answered in step order. */
export function demoCharacter(pkg: ContentPackage, level = 3, name = "Mira Fennwick"): DraftDocument {
  const created = newDraft(pkg, level);
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  let doc = created.doc;
  for (let guard = 0; guard < 100; guard++) {
    const ev = evaluateDraft(pkg, doc);
    if (ev.complete) return doc;
    const open = ev.steps
      .flatMap((s) => s.choices)
      .map((c) => ev.choices[c]!)
      .find((c) => !c.optional && c.status !== "answered" && c.status !== "info")!;
    const r = applyChange(pkg, doc, { type: "answer", choice: open.id, answer: answerFor(open, name) });
    if (!r.ok) throw new Error(`${open.id}: ${JSON.stringify(r.error)}`);
    doc = r.doc;
  }
  throw new Error("demo character did not complete");
}
