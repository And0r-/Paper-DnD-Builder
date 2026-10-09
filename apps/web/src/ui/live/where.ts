/**
 * Where someone is on a character, in the words the live channel carries
 * (`step`): a step's key, or one of the screens around the steps. The same
 * key leads back to the screen, so "Mara is at Folk" is a link there.
 */
import { CAMPAIGN_KEY, RULES_KEY, stepHref } from "../flow/model.ts";

export const SCREENS = ["level", "overview", "done", "raise", "bogen"] as const;

/** The key of the screen at `pathname` (`/c/<id>/...`); null outside a character. */
export function stepOfPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "c") return null;
  if (parts[2] === "step" && parts[3]) return decodeURIComponent(parts[3]);
  if (parts[2] === "campaign") return CAMPAIGN_KEY;
  if (parts[2] === "rules") return RULES_KEY;
  return (SCREENS as readonly string[]).includes(parts[2] ?? "") ? parts[2]! : null;
}

/** The screen of a key, for this character; null for the sheet, which only its owner opens. */
export function hrefOfStep(draftId: string, step: string): string | null {
  if (step === "bogen") return null;
  if (step === "done" || step === "raise") return `/c/${draftId}/${step}`;
  return stepHref(draftId, step);
}
