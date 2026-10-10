"use client";
/**
 * Settings (flow spec 4.8): name and mail address, language, units, the
 * player's passwords, access keys, log out, what we store, delete account.
 * Language and units apply at once, everywhere.
 */
import { effectiveUnits, formatMeasure } from "@builder/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { isAccountName, MAX_ACCOUNT_NAME } from "../../src/shared/account-name.ts";
import { useApp } from "../../src/ui/app-state.tsx";
import { api, ApiError, type Account } from "../../src/ui/api.ts";
import { AccessKeys } from "../../src/ui/components/AccessKeys.tsx";
import { Button } from "../../src/ui/components/Button.tsx";
import { TypedConfirmDialog } from "../../src/ui/components/Dialog.tsx";
import { Callout, ErrorState, Loading } from "../../src/ui/components/Feedback.tsx";
import { Segmented, TextField, Toast } from "../../src/ui/components/Fields.tsx";
import { LanguageSelect } from "../../src/ui/components/LanguageSelect.tsx";
import { Passwords } from "../../src/ui/components/Passwords.tsx";
import { AppShell } from "../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../src/ui/flow/frame.tsx";
import { RequireAccount } from "../../src/ui/guards.tsx";
import { RESEND_AFTER_S, resetLinkError, sendResetLink } from "../../src/ui/reset-link.ts";
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
        <p className="note">{t("settings.signedInAs", { name: account.name })}</p>
        <div aria-live="polite">
          {error && (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          )}
        </div>

        <Identity account={account} />

        <section className="settings__section" aria-labelledby="s-language">
          <h2 className="section-title" id="s-language">
            {t("settings.language")}
          </h2>
          <LanguageSelect onError={fail} />
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
            // "" is "same as the language": nothing stored, the units change with the language.
            const chosen = account.units[dim] ?? "";
            const byLanguage = effectiveUnits(lp.pkg.units, lp.lang, {})[dim]!;
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
                  options={[
                    { value: "", label: t("settings.unitByLanguage", { unit: word(byLanguage) }) },
                    ...d.units.map((u) => ({ value: u, label: word(u) })),
                  ]}
                  value={chosen}
                  onChange={(u) => {
                    setError(undefined);
                    app.setUnit(dim, u === "" ? null : u).catch(fail);
                  }}
                  help={t("settings.example", { example })}
                />
              </div>
            );
          })}
          <p className="note">{t("settings.unitsHint")}</p>
        </section>

        <Passwords />

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

const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The field a `400 badRequest` names first, if any. */
function badField(err: ApiError): string | undefined {
  const issues = err.details["issues"];
  return Array.isArray(issues) ? (issues[0] as { path?: string } | undefined)?.path : undefined;
}

/** Name (what game masters see) and mail address (only a way back in); empty removes the address. */
function Identity({ account }: { account: Account }) {
  const app = useApp();
  const { t } = app;
  const [name, setName] = useState(account.name);
  const [email, setEmail] = useState(account.email ?? "");
  const [nameError, setNameError] = useState<string>();
  /** The rule holds for a new name only: one saved before it stays as it is. */
  const nameProblem = (n: string) =>
    !n.trim() || n.trim() === account.name || isAccountName(n)
      ? undefined
      : t("login.nameInvalid", { max: MAX_ACCOUNT_NAME });
  const [emailError, setEmailError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string>();
  // "Test: send a link": only for the saved address, with the same wait as on the login screen.
  const saved = app.account?.email ?? account.email;
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string>();
  const [testSentAt, setTestSentAt] = useState(0);
  const [now, setNow] = useState(0);
  const wait = testSentAt ? Math.max(0, RESEND_AFTER_S - Math.floor((now - testSentAt) / 1000)) : 0;

  useEffect(() => {
    if (!testSentAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [testSentAt]);

  const test = async () => {
    if (!saved || wait > 0) return;
    setTestError(undefined);
    setTestBusy(true);
    try {
      await sendResetLink(saved, app.lang);
      setTestSentAt(Date.now());
      setNow(Date.now());
      setToast(t("settings.resetTestSent"));
    } catch (err) {
      setTestError(resetLinkError(err, app));
    } finally {
      setTestBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const m = email.trim();
    const nameWrong = n ? nameProblem(n) : t("login.nameMissing");
    setNameError(nameWrong);
    setEmailError(!m || MAIL.test(m) ? undefined : t("login.emailInvalid"));
    if (nameWrong || (m && !MAIL.test(m))) return;
    setError(undefined);
    setBusy(true);
    try {
      const r = await api<{ account: Account }>("PATCH", "/api/account/settings", {
        name: n,
        email: m || null,
      });
      app.setAccount(r.account);
      setName(r.account.name);
      setEmail(r.account.email ?? "");
      setToast(t("settings.identitySaved"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && badField(err) === "name")
        setNameError(t("login.nameInvalid", { max: MAX_ACCOUNT_NAME }));
      else if (err instanceof ApiError && err.status === 400) setEmailError(t("login.emailInvalid"));
      else setError(t("settings.saveError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings__section" aria-labelledby="s-identity">
      <h2 className="section-title" id="s-identity">
        {t("settings.identity")}
      </h2>
      <form className="settings__identity" onSubmit={save} noValidate>
        <TextField
          label={t("settings.nameLabel")}
          help={t("settings.nameHelp")}
          autoComplete="nickname"
          maxLength={MAX_ACCOUNT_NAME}
          value={name}
          error={nameError}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(nameProblem(e.target.value));
          }}
        />
        <TextField
          label={t("settings.emailLabel")}
          help={t("settings.emailHelp")}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          error={emailError}
          onChange={(e) => {
            setEmail(e.target.value);
            setEmailError(undefined);
          }}
        />
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}
        <div>
          <Button type="submit" variant="secondary" busy={busy} busyLabel={t("settings.identitySaving")}>
            {t("settings.identitySave")}
          </Button>
        </div>
      </form>
      {saved && (
        <div className="settings__reset-test">
          <p className="settings__hint">{t("settings.resetTestHelp")}</p>
          {testError && (
            <Callout tone="danger" role="alert">
              {testError}
            </Callout>
          )}
          <div>
            <Button
              variant="secondary"
              icon="mail"
              busy={testBusy}
              busyLabel={t("login.lostSending")}
              aria-disabled={wait > 0 || undefined}
              onClick={test}
            >
              {wait > 0 ? t("login.resendIn", { seconds: wait }) : t("settings.resetTest")}
            </Button>
          </div>
        </div>
      )}
      {toast && <Toast message={toast} duration={4000} onDone={() => setToast(undefined)} />}
    </section>
  );
}
