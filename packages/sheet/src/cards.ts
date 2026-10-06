/**
 * Which held things become a card (SPEC 13): `card: true` and a card layout
 * for its kind in sheet.json. Pure, without pdfkit, so the screen can say
 * whether the printout has cards with the same rule the PDF uses.
 */
import type { Evaluation } from "@builder/core";
import type { ContentPackage, Thing } from "@builder/format/pure";

export function isCard(pkg: ContentPackage, thing: Thing): boolean {
  return thing.card === true && pkg.sheet.cards[thing.kind] !== undefined;
}

/** How many cards the PDF of this evaluation prints. */
export function cardCount(pkg: ContentPackage, ev: Pick<Evaluation, "things">): number {
  const things = new Map(pkg.things.map((t) => [t.id, t]));
  return ev.things.filter((h) => {
    const t = things.get(h.id);
    return t !== undefined && isCard(pkg, t);
  }).length;
}
