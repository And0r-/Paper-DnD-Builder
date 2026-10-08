/**
 * One line carried to the next screen of this window, said there once: a
 * character deleted elsewhere sends the player to their list, which says why.
 * Kept in memory only; a reload forgets it.
 */
let pending: string | null = null;

export function setFlash(text: string): void {
  pending = text;
}

/** The line, until {@link clearFlash}: reading it twice (React's strict mode) still shows it. */
export function peekFlash(): string | null {
  return pending;
}

export function clearFlash(): void {
  pending = null;
}
