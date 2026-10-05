"use client";
/**
 * Settings (flow spec 4.8): language, units, new password, access keys,
 * log out, what we store, delete account. Language and units apply at once, everywhere.
 */
import { effectiveUnits, formatMeasure } from "@builder/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isUiLanguage, UI_LANGUAGES, type UiLanguage } from "../../src/i18n/index.ts";
import { useApp } from "../../src/ui/app-state.tsx";
import { api, type Account } from "../../src/ui/api.ts";
import { AccessKeys } from "../../src/ui/components/AccessKeys.tsx";
import { Button } from "../../src/ui/components/Button.tsx";
import { ConfirmDialog, TypedConfirmDialog } from "../../src/ui/components/Dialog.tsx";
import { Callout, ErrorState, Loading } from "../../src/ui/components/Feedback.tsx";
import { Segmented, Toast } from "../../src/ui/components/Fields.tsx";
import { LanguageSelect } from "../../src/ui/components/LanguageSelect.tsx";
import { AppShell } from "../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../src/ui/flow/frame.tsx";
import { RequireAccount } from "../../src/ui/guards.tsx";
import { measureContext, ptext } from "../../src/ui/package-text.ts";
import { loadPackage, loadPackageList, type LoadedPackage } from "../../src/ui/packages.ts";

export default function SettingsPage() {
  return <RequireAccount>{(account) => <Settings account={account} />}</RequireAccount>;
}

/** One unit choice per dimension the loaded packages know, with words from the first package that has it. */
function useUnitPackages(lang: string) {
  // Kept together with the language it was loaded in: never show words of the previous language.
  const [loaded, setLoaded] = useState<{ lang: string; packages: LoadedPackage[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      const list = await loadPackageList(lang);
      return Promise.all(list.map((p) => loadPackage(p.id, lang)));
    })().then(
      (packages) => live && (setLoaded({ lang, packages }), setFailed(false)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [lang, attempt]);
  return {
    packages: loaded?.lang === lang ? loaded.packages : null,
    failed,
    retry: () => setAttempt((n) => n + 1),
  };
}

function Settings({ account }: { account: Account }) {
  const app = useApp();
  const { t, lang, list } = app;
  const router = useRouter();
  usePageTitle([t("settings.title")]);
  const { packages, failed, retry } = useUnitPackages(lang);
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [askPassword, setAskPassword] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftCount, setDraftCount] = useState<number | null>(null);

  useEffect(() => {
    if (!askDelete) return;
    api<{ drafts: unknown[] }>("GET", "/api/drafts").then(
      (r) => setDraftCount(r.drafts.length),
      () => setDraftCount(null),
    );
  }, [askDelete]);

  // Offer the languages both the builder and every loaded package have.
  const languages: UiLanguage[] = packages
    ? UI_LANGUAGES.filter((l) => packages.every((p) => p.pkg.manifest.languages.includes(l)))
    : [...UI_LANGUAGES];

  const dimensions: { dim: string; lp: LoadedPackage }[] = [];
  for (const lp of packages ?? []) {
    for (const dim of Object.keys(lp.pkg.units.dimensions)) {
      if (!dimensions.some((d) => d.dim === dim)) dimensions.push({ dim, lp });
    }
  }

  const fail = () => setError(t("settings.saveError"));

  return (
    <AppShell>
      <div className="page settings">
        <h1 className="page__title">{t("settings.title")}</h1>
        <p className="note">{t("settings.signedInAs", { email: account.email })}</p>
        <div aria-live="polite">
          {error && (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          )}
        </div>

        <section className="settings__section" aria-labelledby="s-language">
          <h2 className="section-title" id="s-language">
            {t("settings.language")}
          </h2>
          <LanguageSelect languages={languages.filter(isUiLanguage)} onError={fail} />
          <p className="note">{t("settings.languageHint")}</p>
        </section>

        <section className="settings__section" aria-labelledby="s-units">
          <h2 className="section-title" id="s-units">
            {t("settings.units")}
          </h2>
          {failed && <ErrorState onRetry={retry} />}
          {!failed && !packages && <Loading count={1} />}
          {dimensions.map(({ dim, lp }) => {
            const d = lp.pkg.units.dimensions[dim]!;
            const shown = effectiveUnits(lp.pkg.units, lp.lang, account.units)[dim];
            const word = (u: string) => ptext(lp, `unit.${u}.long`) ?? u;
            const ctx = measureContext(lp, account.units);
            // An example from the package's own table, so the reader sees how numbers will look.
            const row = lp.pkg.units.conversions.find((c) => c.from === d.source)?.table;
            const sample = row?.[Math.floor(row.length / 2)]?.[0] ?? 10;
            const example = formatMeasure(ctx, { amount: sample, unit: d.source }, "long");
            return (
              <div className="settings__units" key={dim}>
                <Segmented
                  legend={
                    d.units.length === 2
                      ? t("settings.unitOr", { a: word(d.units[0]!), b: word(d.units[1]!) })
                      : list(d.units.map(word))
                  }
                  name={`unit-${dim}`}
                  options={d.units.map((u) => ({ value: u, label: word(u) }))}
                  value={shown}
                  onChange={(u) => {
                    setError(undefined);
                    app.setUnit(dim, u).catch(fail);
                  }}
                  help={t("settings.example", { example })}
                />
              </div>
            );
          })}
          <p className="note">{t("settings.unitsHint")}</p>
        </section>

        <section className="settings__section" aria-labelledby="s-password">
          <h2 className="section-title" id="s-password">
            {t("settings.password")}
          </h2>
          <p>{t("settings.passwordText")}</p>
          <Button variant="secondary" icon="mail" onClick={() => setAskPassword(true)}>
            {t("settings.passwordButton")}
          </Button>
        </section>

        <AccessKeys />

        <section className="settings__section" aria-labelledby="s-logout">
          <h2 className="section-title" id="s-logout">
            {t("settings.logout")}
          </h2>
          <p>{t("settings.logoutText")}</p>
          <Button
            variant="secondary"
            onClick={async () => {
              await app.logout().catch(fail);
              router.push("/login");
            }}
          >
            {t("settings.logout")}
          </Button>
        </section>

        <section className="settings__section" aria-labelledby="s-privacy">
          <h2 className="section-title" id="s-privacy">
            {t("settings.privacy")}
          </h2>
          <p>
            {t("settings.privacyText")} <Link href="/privacy">{t("settings.privacyLink")}</Link>
          </p>
        </section>

        <section className="settings__section settings__section--danger" aria-labelledby="s-delete">
          <h2 className="section-title" id="s-delete">
            {t("settings.delete")}
          </h2>
          <p>{t("settings.deleteText")}</p>
          <ul className="settings__cases">
            <li>{t("settings.deletePlayer")}</li>
            <li>{t("settings.deleteGameMaster")}</li>
          </ul>
          <Button variant="danger" onClick={() => setAskDelete(true)}>
            {t("settings.delete")}
          </Button>
        </section>
      </div>

      <ConfirmDialog
        open={askPassword}
        title={t("settings.passwordConfirmTitle")}
        confirmLabel={t("settings.passwordConfirm")}
        busy={busy}
        onCancel={() => setAskPassword(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api("POST", "/api/account/password", {});
            setToast(t("settings.passwordSent"));
          } catch {
            fail();
          } finally {
            setBusy(false);
            setAskPassword(false);
          }
        }}
      >
        <p>{t("settings.passwordConfirmText")}</p>
      </ConfirmDialog>

      <TypedConfirmDialog
        open={askDelete}
        title={t("settings.deleteTitle")}
        word={t("settings.deleteWord")}
        label={t("settings.deleteTypeLabel", { word: t("settings.deleteWord") })}
        mismatch={t("settings.deleteMismatch", { word: t("settings.deleteWord") })}
        confirmLabel={t("settings.deleteConfirm")}
        busy={busy}
        onCancel={() => setAskDelete(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api("DELETE", "/api/account", { confirm: true });
            // The goodbye page reloads the (now missing) account itself.
            router.replace("/goodbye");
          } catch {
            setBusy(false);
            setAskDelete(false);
            fail();
          }
        }}
      >
        <p>{t("settings.deleteDialogText", { count: draftCount ?? "…" })}</p>
        <p>{t("settings.deletePlayer")}</p>
        <p>{t("settings.deleteGameMaster")}</p>
      </TypedConfirmDialog>

      {toast && <Toast message={toast} duration={6000} onDone={() => setToast(undefined)} />}
    </AppShell>
  );
}
