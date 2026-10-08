"use client";
/**
 * Extensions of the character's package (SPEC 17): one switch each, under
 * the level. Shown only when the package has an extension. Off by default;
 * it can be switched on later, also when raising the level. It goes off
 * only while no answer comes from it; until then the switch says which
 * choices to change first.
 */
import { useEffect, useId, useState } from "react";
import { answersFromExtension } from "@builder/core";
import { useApp } from "../app-state.tsx";
import type { ExtensionListEntry } from "../api.ts";
import { Callout } from "../components/Feedback.tsx";
import { Icon } from "../components/Icon.tsx";
import { loadPackageList } from "../packages.ts";
import { ptext } from "../package-text.ts";
import { useDraft } from "./draft-state.tsx";

/** The extensions a character of this package may switch on; empty until known, or if there are none. */
function useOffered(packageId: string, lang: string): ExtensionListEntry[] {
  const [offered, setOffered] = useState<ExtensionListEntry[]>([]);
  useEffect(() => {
    let live = true;
    loadPackageList(lang).then(
      (list) => live && setOffered(list.find((p) => p.id === packageId)?.extensions ?? []),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [packageId, lang]);
  return offered;
}

export function ExtensionSwitches() {
  const { t, lang } = useApp();
  const { lp, draft, doc, setExtensions } = useDraft();
  const offered = useOffered(draft.packageId, lang);
  const id = useId();
  // The switch being changed and where it goes: it shows that at once, until the server answers.
  const [busy, setBusy] = useState<{ id: string; on: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  if (offered.length === 0) return null;

  const languageName = (code: string) => new Intl.DisplayNames([lang], { type: "language" }).of(code) ?? code;
  const toggle = async (ext: string, on: boolean) => {
    setBusy({ id: ext, on });
    setFailed(false);
    const next = on ? [...draft.extensions, ext] : draft.extensions.filter((e) => e !== ext);
    const r = await setExtensions(next);
    setBusy(null);
    if (r !== "ok") setFailed(true);
  };

  return (
    <div className="extensions">
      {offered.map((x) => {
        const stored = draft.extensions.includes(x.id);
        const on = busy?.id === x.id ? busy.on : stored;
        const info = lp.pkg.extensions?.find((e) => e.id === x.id);
        const used = stored && info ? answersFromExtension(info, doc.answers) : [];
        const locked = used.length > 0;
        const notes = [
          !x.languages.includes(lang)
            ? t("extensions.otherLanguage", { language: languageName(x.languages[0]!) })
            : x.languages[0] !== lang
              ? t("extensions.someLanguage", { language: languageName(x.languages[0]!) })
              : null,
          x.publishable ? null : t("extensions.notForSharing"),
        ].filter((n): n is string => n !== null);
        const titles = used.map((c) => ptext(lp, `choice.${c.split("@")[0]}.title`) ?? c);
        return (
          <div
            key={x.id}
            className={`option option--compact${on ? " option--checked" : ""}`}
            aria-busy={busy?.id === x.id || undefined}
          >
            <div className="option__head">
              <input
                className="option__input"
                type="checkbox"
                id={`${id}-${x.id}`}
                checked={on}
                disabled={busy !== null || locked}
                onChange={() => void toggle(x.id, !on)}
                aria-describedby={`${id}-${x.id}-text`}
              />
              <span className="option__mark" aria-hidden="true">
                {on && <Icon name="check" size={18} />}
              </span>
              <label className="option__name" htmlFor={`${id}-${x.id}`}>
                {t("extensions.on", { name: x.name ?? x.id })}
              </label>
            </div>
            <p className="option__short" id={`${id}-${x.id}-text`}>
              {[x.short, ...notes].filter(Boolean).join(" · ")}
              {locked && (
                <>
                  <br />
                  {t("extensions.inUse", { choices: new Intl.ListFormat(lang).format(titles) })}
                </>
              )}
            </p>
          </div>
        );
      })}
      <div aria-live="polite">
        {failed && (
          <Callout tone="danger" role="alert">
            {t("extensions.failed")}
          </Callout>
        )}
      </div>
    </div>
  );
}
