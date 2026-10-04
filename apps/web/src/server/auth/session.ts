/**
 * Session tokens and the session cookie.
 *
 * The browser holds a random 256-bit token in an httpOnly cookie. The
 * database stores only its SHA-256, so a leaked database does not contain
 * usable sessions. Sessions last long (players rarely need their password)
 * and are extended while in use.
 */
import { createHash, randomBytes } from "node:crypto";

export const SESSION_DAYS = 180;
export const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/** Extend a session at most once a day, not on every request. */
export const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** `__Host-` makes the browser refuse the cookie unless it is Secure, host-only and for path /. */
export function cookieName(secure: boolean): string {
  return secure ? "__Host-session" : "session";
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${cookieName(secure)}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MS / 1000}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [
    `${cookieName(secure)}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function readSessionToken(cookieHeader: string | null, secure: boolean): string | undefined {
  if (!cookieHeader) return undefined;
  const name = cookieName(secure);
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
    }
  }
  return undefined;
}
