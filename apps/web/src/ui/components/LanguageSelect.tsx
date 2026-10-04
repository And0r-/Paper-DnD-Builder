"use client";
import { useState } from "react";
import { LANGUAGE_NAMES, UI_LANGUAGES, type UiLanguage } from "../../i18n/index.ts";
import { useApp } from "../app-state.tsx";
import { Segmented } from "./Fields.tsx";

/**
 * Languages named in themselves ("Deutsch", "English"), each marked with
 * its own `lang`. No flags: flags are countries, not languages.
 */
export function LanguageSelect({
  compact,
  languages = UI_LANGUAGES,
  onError,
}: {
  compact?: boolean;
  languages?: readonly UiLanguage[];
  onError?: () => void;
}) {
  const { t, lang, setLanguage } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <div
      className={compact ? "language-select language-select--compact" : "language-select"}
      aria-busy={busy}
    >
      <Segmented
        legend={t("language.label")}
        legendHidden={compact ?? false}
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
