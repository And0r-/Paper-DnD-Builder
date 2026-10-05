/**
 * Placeholders inside translated texts.
 *
 * - `{{length:30}}`        a quantity, amount in the source unit of the
 *                          dimension; shown converted to the reader's unit
 * - `{{length:30|short}}`  same, with the short unit form ("m", "ft")
 * - `{{var:name}}`         a value supplied by the screen that shows the
 *                          text (documented per text key in SPEC.md)
 * - `{{var:name|signed}}`  same, a number always with its sign ("+3", "-1")
 * - `[[glossary:id|text]]` `text` is shown, marked as a glossary term
 */

export type TemplatePart =
  | { type: "text"; text: string }
  | { type: "quantity"; dimension: string; amount: number; form: "long" | "short" }
  | { type: "var"; name: string; signed?: true }
  | { type: "glossary"; id: string; text: string };

export class TemplateSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateSyntaxError";
  }
}

const TOKEN = /\{\{([^{}]*)\}\}|\[\[([^[\]]*)\]\]/g;
const QUANTITY = /^([a-z][a-z0-9-]*):(-?[0-9]+(?:\.[0-9]+)?)(?:\|(short|long))?$/;
const VAR = /^var:([a-zA-Z][a-zA-Z0-9]*)(\|signed)?$/;
const GLOSSARY = /^glossary:([a-z0-9]+(?:[.-][a-z0-9]+)*)\|([^|]+)$/;

export function parseTemplate(src: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    if (m.index > last) parts.push({ type: "text", text: src.slice(last, m.index) });
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      const inner = m[1].trim();
      const v = VAR.exec(inner);
      if (v) {
        parts.push(v[2] ? { type: "var", name: v[1]!, signed: true } : { type: "var", name: v[1]! });
        continue;
      }
      const q = QUANTITY.exec(inner);
      if (q) {
        parts.push({
          type: "quantity",
          dimension: q[1]!,
          amount: Number(q[2]),
          form: (q[3] as "short" | "long" | undefined) ?? "long",
        });
        continue;
      }
      throw new TemplateSyntaxError(
        `bad placeholder "{{${m[1]}}}": use {{dimension:amount}}, {{dimension:amount|short}}, {{var:name}} or {{var:name|signed}}`,
      );
    }
    const g = GLOSSARY.exec(m[2]!.trim());
    if (!g) throw new TemplateSyntaxError(`bad glossary link "[[${m[2]}]]": use [[glossary:id|shown text]]`);
    parts.push({ type: "glossary", id: g[1]!, text: g[2]! });
  }
  if (last < src.length) parts.push({ type: "text", text: src.slice(last) });
  for (const p of parts) {
    if (p.type === "text" && /\{\{|\}\}|\[\[|\]\]/.test(p.text)) {
      throw new TemplateSyntaxError(`unbalanced "{{", "}}", "[[" or "]]" in "${p.text}"`);
    }
  }
  return parts;
}
