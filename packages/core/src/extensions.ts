/**
 * Answers that come from an extension (SPEC 17.7). A character may switch
 * an extension off only while none of its answers comes from it: such an
 * answer would silently stop counting.
 */
import type { ExtensionInfo } from "@builder/format/pure";
import type { DraftDocument } from "./draft.ts";

/**
 * The choices whose answers come from the extension: a choice it declares
 * (or a copy of one, or a copy asked by one of its things), or an answer
 * that names one of its things.
 */
export function answersFromExtension(
  ext: Pick<ExtensionInfo, "things" | "choices">,
  answers: DraftDocument["answers"],
): string[] {
  const things = new Set(ext.things);
  const choices = new Set(ext.choices);
  // Answers are small JSON ({ pick }, { picks }, ...): any string in it that is a thing of the extension counts.
  const names = (a: unknown): boolean =>
    typeof a === "string"
      ? things.has(a)
      : typeof a === "object" && a !== null && Object.values(a).some(names);
  return Object.entries(answers)
    .filter(([id, answer]) => {
      const [declared, where] = id.split("@");
      if (choices.has(declared!)) return true;
      if (where !== undefined && (things.has(where) || choices.has(where))) return true;
      return names(answer);
    })
    .map(([id]) => id);
}
