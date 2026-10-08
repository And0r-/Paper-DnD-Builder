/**
 * The help link a helper came with (AND-246). Every call on the owner's
 * character needs it (`?help=<token>`), on every page under /c/[id], so it
 * waits in this browser's local storage, keyed by the character: a second
 * tab, or the page opened again later, still works while the link does.
 * When the server says the link is gone, it is forgotten.
 */
const key = (draftId: string) => `help:${draftId}`;

export function rememberHelpToken(draftId: string, token: string): void {
  try {
    localStorage.setItem(key(draftId), token);
  } catch {
    // Storage off: this page works with the link; another page asks for it again.
  }
}

export function helpTokenFor(draftId: string): string | null {
  try {
    return localStorage.getItem(key(draftId));
  } catch {
    return null;
  }
}

export function forgetHelpToken(draftId: string): void {
  try {
    localStorage.removeItem(key(draftId));
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/** A draft route, with the help link when this browser helps with the character. */
export function draftPath(draftId: string, rest = ""): string {
  const token = helpTokenFor(draftId);
  const path = `/api/drafts/${encodeURIComponent(draftId)}${rest}`;
  return token ? `${path}?help=${encodeURIComponent(token)}` : path;
}
