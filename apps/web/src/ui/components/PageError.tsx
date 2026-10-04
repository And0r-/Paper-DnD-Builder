"use client";
/**
 * The last-resort error screen, shared by app/error.tsx (inside the app
 * frame) and app/global-error.tsx (when even the root layout failed). It
 * needs nothing but a translator, so it works without the app state.
 *
 * A failed chunk load almost always means the server was rebuilt while the
 * page was open: the old files are gone. One automatic reload fetches the
 * new ones, so the player usually never sees this screen.
 */
import { useEffect } from "react";
import { isUiLanguage, pickLanguage, type Translator, type UiLanguage } from "../../i18n/index.ts";
import { Button } from "./Button.tsx";
import { EmptyState } from "./Feedback.tsx";

const RELOADED_AT = "builder.chunkReloadAt";
/** No second automatic reload within this time: a broken build must not loop. */
const RELOAD_PAUSE_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || /loading (css )?chunk|failed to load chunk/i.test(error.message);
}

/** Reloads the page once when the error is a missing chunk. */
export function useReloadOnChunkError(error: unknown): void {
  useEffect(() => {
    if (!isChunkLoadError(error)) return;
    try {
      const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
      if (Date.now() - last < RELOAD_PAUSE_MS) return;
      sessionStorage.setItem(RELOADED_AT, String(Date.now()));
    } catch {
      return; // No storage: no automatic reload, the buttons still work.
    }
    window.location.reload();
  }, [error]);
}

/**
 * The screen language without the app state: the one the server rendered
 * (account, else chosen before login, else browser), else the language
 * cookie, else the browser's.
 */
export function documentLanguage(): UiLanguage {
  const rendered = document.documentElement.lang;
  if (isUiLanguage(rendered)) return rendered;
  // The cookie is LANGUAGE_COOKIE from app-state.tsx, not imported to keep this screen light.
  const chosen = /(?:^|;\s*)lang=([^;]*)/.exec(document.cookie)?.[1];
  if (isUiLanguage(chosen)) return chosen;
  return pickLanguage(navigator.languages.join(","));
}

function back() {
  if (window.history.length > 1) window.history.back();
  // A full load on purpose: the client router may be the code that failed.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  else window.location.assign("/");
}

export function PageError({ t }: { t: Translator["t"] }) {
  return (
    <EmptyState icon="alert" title={t("common.errorTitle")}>
      <p>{t("common.errorText")}</p>
      <Button onClick={() => window.location.reload()}>{t("common.reload")}</Button>
      <Button variant="secondary" icon="arrowLeft" onClick={back}>
        {t("common.back")}
      </Button>
    </EmptyState>
  );
}
