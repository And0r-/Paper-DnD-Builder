/**
 * The language of the first paint (html lang, page title): the account's
 * setting when a session cookie is present, else the language chosen
 * before login (cookie), else the browser's. Read-only: it never refreshes
 * or creates a session.
 */
import { isUiLanguage, pickLanguage, type UiLanguage } from "../i18n/index.ts";
import { getApp } from "./app.ts";
import { readSessionToken, sessionId } from "./auth/session.ts";

export async function screenLanguage(
  cookieHeader: string | null,
  chosen: string | undefined,
  acceptLanguage: string | null,
): Promise<UiLanguage> {
  try {
    const app = await getApp();
    const token = readSessionToken(cookieHeader, app.config.secureCookies);
    if (token) {
      const session = await app.store.findSession(sessionId(token), app.now());
      if (session && isUiLanguage(session.account.language)) return session.account.language;
    }
  } catch {
    // No database (yet): fall back to what the browser tells us.
  }
  return isUiLanguage(chosen) ? chosen : pickLanguage(acceptLanguage);
}
