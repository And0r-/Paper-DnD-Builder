/**
 * "You now play in …" (AND-241): said once, on the first screen of the
 * character made right after joining from an invitation. The invitation
 * page and the step are different pages, so the campaign's name waits in
 * this tab's session storage, keyed by the character, and is taken (read
 * and removed) by the step that shows it.
 */
const key = (draftId: string) => `joined:${draftId}`;

export function rememberJoined(draftId: string, campaignName: string): void {
  try {
    sessionStorage.setItem(key(draftId), campaignName);
  } catch {
    // Storage off: the character is in the campaign all the same; only the sentence is missing.
  }
}

export function takeJoined(draftId: string): string | null {
  try {
    const name = sessionStorage.getItem(key(draftId));
    sessionStorage.removeItem(key(draftId));
    return name;
  } catch {
    return null;
  }
}
