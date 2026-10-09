/**
 * This window's own id (API.md "Where a change comes from"): sent on the
 * live channel's address and on every change over HTTP, so a change that
 * comes back over the channel is known as this window's own. A label, not a
 * login; it lives as long as the page and is new after a reload.
 */
let id: string | null = null;

export function clientId(): string {
  if (id === null) {
    const c = globalThis.crypto;
    if (typeof c?.randomUUID === "function") id = c.randomUUID().replaceAll("-", "");
    else {
      // randomUUID needs a secure context; a plain http address on a home network has none.
      const bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  }
  return id;
}

/** The request header that carries {@link clientId}. */
export const CLIENT_ID_HEADER = "x-builder-client-id";
