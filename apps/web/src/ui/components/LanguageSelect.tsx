"use client";
import { useState } from "react";
import { LANGUAGE_NAMES, UI_LANGUAGES, type UiLanguage } from "../../i18n/index.ts";
import { useApp } from "../app-state.tsx";
import { useOfferedLanguages } from "../packages.ts";
import { CompactSelect, Segmented, Toast } from "./Fields.tsx";

/**
 * The languages to offer: the ones the installed packages have (and the
 * builder can show), plus the one on screen, so it is never missing.
 */
function useLanguages(): readonly UiLanguage[] {
  const { lang } = useApp();
  const offered = useOfferedLanguages(UI_LANGUAGES, lang);
  return offered.includes(lang) ? offered : UI_LANGUAGES.filter((l) => l === lang || offered.includes(l));
}

/**
 * Languages named in themselves ("Deutsch", "English"), each marked with
 * its own `lang`. No flags: flags are countries, not languages.
 */
export function LanguageSelect({ onError }: { onError?: () => void }) {
  const { t, lang, setLanguage } = useApp();
  const languages = useLanguages();
  const [busy, setBusy] = useState(false);
  return (
    <div className="language-select" aria-busy={busy}>
      <Segmented
        legend={t("language.label")}
        name="language"
        options={languages.map((l) => ({ value: l, label: LANGUAGE_NAMES[l], lang: l }))}
        value={lang}
        onChange={async (next) => {
          setBusy(true);
          try {
            await setLanguage(next);
          } catch {
            onError?.();
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

/**
 * The language switch in the top bar of every screen (AND-153): a native
 * select under the hood, so keyboards and screen readers get what they
 * know. It sets the same value as the settings; units are left alone
 * (plan 5.6). Everything that shows a language's words follows it from the
 * app state, the sheet too.
 */
export function LanguageMenu() {
  const { t, lang, setLanguage } = useApp();
  const languages = useLanguages();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <CompactSelect
        className="language-menu"
        label={t("language.label")}
        icon="globe"
        value={lang}
        busy={busy}
        options={languages.map((l) => ({ value: l, label: LANGUAGE_NAMES[l], lang: l }))}
        onChange={async (next) => {
          setBusy(true);
          setFailed(false);
          try {
            await setLanguage(next as UiLanguage);
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      />
      {failed && <Toast message={t("settings.saveError")} onDone={() => setFailed(false)} />}
    </>
  );
}
