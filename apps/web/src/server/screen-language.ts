/**
 * What the first paint needs to know: the language (html lang, page title)
 * and whether there is a session at all. The language is the account's
 * setting when a session cookie is present, else the language chosen before
 * login (cookie), else the browser's. Read-only: it never refreshes or
 * creates a session.
 */
import { isUiLanguage, pickLanguage, type UiLanguage } from "../i18n/index.ts";
import { getApp } from "./app.ts";
import { readSessionToken, sessionId } from "./auth/session.ts";

export interface FirstPaint {
  language: UiLanguage;
  /**
   * False only when there is certainly no session (no valid cookie, or one
   * the database does not know): the screen then skips asking the API for
   * the account, which could only answer 401.
   */
  maybeSignedIn: boolean;
}

export async function firstPaint(
  cookieHeader: string | null,
  chosen: string | undefined,
  acceptLanguage: string | null,
): Promise<FirstPaint> {
  const guest = isUiLanguage(chosen) ? chosen : pickLanguage(acceptLanguage);
  let token: string | undefined;
  try {
    const app = await getApp();
    token = readSessionToken(cookieHeader, app.config.secureCookies);
    if (!token) return { language: guest, maybeSignedIn: false };
    const session = await app.store.findSession(sessionId(token), app.now());
    if (!session) return { language: guest, maybeSignedIn: false };
    return {
      language: isUiLanguage(session.account.language) ? session.account.language : guest,
      maybeSignedIn: true,
    };
  } catch {
    // No database (yet): fall back to what the browser tells us; the API decides about the session.
    return { language: guest, maybeSignedIn: token !== undefined || cookieHeader !== null };
  }
}
