/**
 * Where on the screen a change made elsewhere landed (AND-271): the card
 * that was picked, the row whose number changed, the question, the level
 * in the top bar. As a CSS selector, so the spot still lights up when the
 * screen draws it anew a moment later (a question that takes an answer
 * from elsewhere starts its rows afresh).
 */
import type { Told } from "./words.ts";

/** How long the spot stays lit; the same as `live-flash` in flow.css. */
export const FLASH_MS = 3000;

function quote(s: string): string {
  return `"${s.replace(/["\\]/g, "\\$&")}"`;
}

/** Selectors for the spots of a change, most precise first; empty when it has no place on a screen. */
export function spotsOf(told: Pick<Told, "change" | "parts">): string[] {
  const c = told.change;
  if (!c) return [];
  switch (c.kind) {
    case "answer": {
      const block = `[id=${quote(`block-${c.choice}`)}]`;
      const parts = (told.parts ?? []).flatMap((p) => [
        `${block} [data-option=${quote(p)}]`,
        `${block} [data-target=${quote(p)}]`,
      ]);
      return [...parts, block];
    }
    case "pool":
      return ['[id="block-pool"]'];
    case "level":
    case "levelUp":
      return [".topbar__level"];
    default:
      return [];
  }
}

/** The spots this screen shows: the precise ones if any are there, else the question as a whole. */
export function findSpot(spots: string[], root: ParentNode = document): string | null {
  const [whole] = spots.slice(-1);
  const precise = spots.slice(0, -1).filter((s) => root.querySelector(s));
  if (precise.length > 0) return precise.join(", ");
  return whole && root.querySelector(whole) ? whole : null;
}

/**
 * The rule that lights a spot up; a frame in forced colours, where shadows
 * do not show. `again` takes the other of two equal animations, so a second
 * "Show" lights it up anew.
 */
export function flashCss(selector: string, again = false): string {
  const name = again ? "live-flash-again" : "live-flash";
  return (
    `:is(${selector}) { animation: ${name} ${FLASH_MS}ms ease-out; }\n` +
    `@media (forced-colors: active) { :is(${selector}) { outline: 3px solid Highlight; outline-offset: 3px; } }`
  );
}
