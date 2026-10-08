"use client";
/**
 * One sentence when a game is not in the screen language and is shown in
 * another (English, if the package has it): the words of the game then
 * differ from the screen's, and the player must know why. Both languages
 * are named in the screen language ("Französisch", "Englisch").
 */
import { useApp } from "../app-state.tsx";
import { Callout } from "./Feedback.tsx";

export function languageName(screen: string, code: string): string {
  try {
    return new Intl.DisplayNames([screen], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function PackageLanguageNote({ shown }: { shown: string }) {
  const { t, lang } = useApp();
  if (shown === lang) return null;
  return (
    <div className="package-language-note">
      <Callout tone="info">
        {t("package.otherLanguage", {
          language: languageName(lang, lang),
          shown: languageName(lang, shown),
        })}
      </Callout>
    </div>
  );
}
