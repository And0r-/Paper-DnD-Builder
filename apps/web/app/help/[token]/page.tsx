"use client";
/**
 * A help link (AND-246): someone asks for help with a character. The page
 * says who asks and what helping means; whoever is logged in helps with
 * one button and lands in the character; the row at the top says where
 * the owner is and leads there.
 * Whoever is not logged in gets "Get started" right here, as on an
 * invitation (AND-237): a name, the password, and in. "I already have a
 * password" goes to the login and comes back here.
 */
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "../../../src/ui/app-state.tsx";
import { api, ApiError } from "../../../src/ui/api.ts";
import { Button, ButtonLink } from "../../../src/ui/components/Button.tsx";
import { Callout, Loading } from "../../../src/ui/components/Feedback.tsx";
import { Explained } from "../../../src/ui/components/Explained.tsx";
import { GetStarted } from "../../../src/ui/components/GetStarted.tsx";
import { GuestShell } from "../../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../../src/ui/flow/frame.tsx";
import { rememberHelpToken } from "../../../src/ui/live/help-token.ts";

interface HelpInfo {
  draftId: string;
  owner: { name: string };
  expiresAt: string;
  /** The viewer owns the character: they need no link for it. */
  yours: boolean;
}

type State =
  { kind: "loading" } | { kind: "help"; help: HelpInfo } | { kind: "notFound" } | { kind: "failed" };

export default function HelpPage() {
  const app = useApp();
  const { t, account } = app;
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [going, setGoing] = useState(false);
  // A password just made: shown in the register form until the newcomer says they have it.
  const [registered, setRegistered] = useState(false);
  const path = `/help/${encodeURIComponent(token)}`;

  usePageTitle([
    registered
      ? t("password.title")
      : state.kind === "help"
        ? t("helpPage.title", { owner: state.help.owner.name })
        : state.kind === "notFound"
          ? t("helpPage.notFoundTitle")
          : t("helpPage.checking"),
  ]);

  // Asked again once logged in: `yours` depends on who looks.
  const loggedIn = !!account;
  useEffect(() => {
    let live = true;
    api<HelpInfo>("GET", `/api/help/${encodeURIComponent(token)}`).then(
      (help) => live && setState({ kind: "help", help }),
      (e) => live && setState({ kind: e instanceof ApiError && e.status === 404 ? "notFound" : "failed" }),
    );
    return () => {
      live = false;
    };
  }, [token, attempt, loggedIn]);

  function go(help: HelpInfo) {
    setGoing(true);
    rememberHelpToken(help.draftId, token);
    // The overview first; the row at the top leads to the step the owner is on.
    router.replace(`/c/${encodeURIComponent(help.draftId)}/overview`);
  }

  let content;
  if (state.kind === "notFound") {
    content = (
      <section className="auth__card" aria-labelledby="help-title">
        <h1 className="auth__title" id="help-title">
          {t("helpPage.notFoundTitle")}
        </h1>
        <p className="auth__intro">{t("helpPage.notFound")}</p>
        <ButtonLink href={account ? "/characters" : "/login"} variant="secondary">
          {t("join.toStart")}
        </ButtonLink>
      </section>
    );
  } else if (state.kind === "failed") {
    content = (
      <Callout tone="danger" role="alert">
        <p>{t("common.loadError")}</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {t("common.retry")}
        </Button>
      </Callout>
    );
  } else if (state.kind === "loading" || account === undefined) {
    content = <Loading shape="page" count={2} />;
  } else if (account && state.help.yours) {
    content = (
      <section className="auth__card" aria-labelledby="help-title">
        <h1 className="auth__title" id="help-title">
          {t("helpPage.ownTitle")}
        </h1>
        <p className="auth__intro">{t("helpPage.ownText")}</p>
        <ButtonLink href={`/c/${encodeURIComponent(state.help.draftId)}/overview`} block>
          {t("helpPage.toCharacter")}
        </ButtonLink>
      </section>
    );
  } else {
    const { help } = state;
    content = (
      <>
        {!registered && (
          <section className="auth__card" aria-labelledby="help-title">
            <h1 className="auth__title" id="help-title">
              {t("helpPage.title", { owner: help.owner.name })}
            </h1>
            <p className="auth__intro">{t("helpPage.text", { owner: help.owner.name })}</p>
            {account && (
              <>
                <Button
                  block
                  icon="people"
                  busy={going}
                  busyLabel={t("helpPage.going")}
                  onClick={() => go(help)}
                >
                  {t("helpPage.go")}
                </Button>
                <ButtonLink href="/characters" variant="ghost">
                  {t("helpPage.notNow")}
                </ButtonLink>
              </>
            )}
          </section>
        )}
        {!account && (
          <GetStarted
            title={t("helpPage.startTitle")}
            heading="h2"
            intro={t("helpPage.startIntro", { owner: help.owner.name })}
            onStarted={() => setRegistered(true)}
            onDone={(r) => {
              app.setAccount(r.account);
              setRegistered(false);
              go(help);
            }}
            footer={
              <p className="auth__switch">
                <ButtonLink href={`/login?next=${encodeURIComponent(path)}`} variant="ghost">
                  {t("login.havePassword")}
                </ButtonLink>
              </p>
            }
          />
        )}
      </>
    );
  }

  return (
    <GuestShell>
      <div className="auth">
        {/* As on the login page: the name explains itself where a newcomer sees it first. */}
        <p className="auth__brand">
          <Explained hint={t("app.about")}>
            <span>{t("app.name")}</span>
          </Explained>
        </p>
        {content}
      </div>
    </GuestShell>
  );
}
