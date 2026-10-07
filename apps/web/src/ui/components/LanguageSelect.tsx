"use client";
import { useId, useState } from "react";
import { LANGUAGE_NAMES, UI_LANGUAGES, type UiLanguage } from "../../i18n/index.ts";
import { useApp } from "../app-state.tsx";
import { useOfferedLanguages } from "../packages.ts";
import { Segmented, Toast } from "./Fields.tsx";
import { Icon } from "./Icon.tsx";

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
 * The language switch in the top bar of every screen (AND-153): a plain
 * select, so keyboards and screen readers get what they know. It sets the
 * same value as the settings; units are left alone (plan 5.6).
 */
export function LanguageMenu() {
  const { t, lang, setLanguage } = useApp();
  const languages = useLanguages();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="language-menu">
      <label className="visually-hidden" htmlFor={id}>
        {t("language.label")}
      </label>
      <Icon name="globe" size={20} className="language-menu__icon" />
      <select
        id={id}
        className="language-menu__select"
        value={lang}
        aria-busy={busy}
        onChange={async (e) => {
          const next = e.target.value as UiLanguage;
          setBusy(true);
          setFailed(false);
          try {
            await setLanguage(next);
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {languages.map((l) => (
          <option key={l} value={l} lang={l}>
            {LANGUAGE_NAMES[l]}
          </option>
        ))}
      </select>
      {failed && <Toast message={t("settings.saveError")} onDone={() => setFailed(false)} />}
    </div>
  );
}
