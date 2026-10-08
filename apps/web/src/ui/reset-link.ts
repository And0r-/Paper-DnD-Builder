/**
 * Asking for a link back in by mail (AND-236), from the login screen and,
 * as a test, from the settings. The server answers the same whether the
 * address has an account or not; only real failures come back here.
 */
import type { Translator } from "../i18n/index.ts";
import { api, ApiError } from "./api.ts";

/** Seconds before "Send again" works: a mail can take a moment. */
export const RESEND_AFTER_S = 60;

export async function sendResetLink(email: string, language: string): Promise<void> {
  await api("POST", "/api/auth/reset", { email, language });
}

/** The words for a failed request; `400` (not an address) is up to the caller's field. */
export function resetLinkError(error: unknown, { t, tc }: Translator): string {
  const e = error instanceof ApiError ? error : new ApiError(0, "network");
  if (e.status === 429) return tc("login.tooManyMails", Math.max(1, Math.ceil((e.retryAfter ?? 300) / 60)));
  if (e.code === "mailNotConfigured") return t("login.mailNotConfigured");
  if (e.isNetwork) return t("common.offline");
  return t("login.mailFailed");
}
