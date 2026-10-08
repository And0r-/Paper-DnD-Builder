"use client";
/**
 * An invitation link (AND-237): who invites to which campaign, and what
 * that means. Whoever is logged in joins with one button and goes on to
 * a new character with the campaign chosen ("no campaign" stays a choice).
 *
 * Whoever is not logged in gets "Get started" right here, not on a detour
 * through the login screen: on a phone, a newcomer types a name, keeps the
 * password and is in the campaign, building. "I already have a password"
 * goes to the login and comes back here.
 *
 * Whoever leads the campaign, or plays in it already (also from an old
 * link that was replaced), is told so instead of being asked to join
 * (AND-241).
 */
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "../../../src/ui/app-state.tsx";
import { api, ApiError, type Invite } from "../../../src/ui/api.ts";
import { Button, ButtonLink } from "../../../src/ui/components/Button.tsx";
import { Callout, Loading } from "../../../src/ui/components/Feedback.tsx";
import { Explained } from "../../../src/ui/components/Explained.tsx";
import { GetStarted } from "../../../src/ui/components/GetStarted.tsx";
import { GuestShell } from "../../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../../src/ui/flow/frame.tsx";

type State =
  { kind: "loading" } | { kind: "invite"; invite: Invite } | { kind: "notFound" } | { kind: "failed" };

export default function JoinPage() {
  const app = useApp();
  const { t, tc, account } = app;
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // A password just made: shown in the register form until the newcomer says they have it, then they join.
  const [registered, setRegistered] = useState(false);
  const path = `/join/${encodeURIComponent(token)}`;

  usePageTitle([
    registered
      ? t("password.title")
      : state.kind === "invite"
        ? state.invite.campaign.name
        : state.kind === "notFound"
          ? t("join.notFoundTitle")
          : t("join.checking"),
  ]);

  useEffect(() => {
    let live = true;
    api<Invite>("GET", `/api/invites/${encodeURIComponent(token)}`).then(
      (invite) => live && setState({ kind: "invite", invite }),
      (e) => live && setState({ kind: e instanceof ApiError && e.status === 404 ? "notFound" : "failed" }),
    );
    return () => {
      live = false;
    };
  }, [token, attempt]);

  async function join() {
    setBusy(true);
    setError(undefined);
    try {
      const { campaignId } = await api<{ campaignId: string }>(
        "POST",
        `/api/invites/${encodeURIComponent(token)}/join`,
      );
      router.replace(`/new?campaign=${encodeURIComponent(campaignId)}&joined`);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "network");
      if (err.status === 404) setState({ kind: "notFound" });
      else if (err.code === "tooManyPlayers")
        setError(t("campaign.tooManyPlayers", { max: Number(err.details["max"]) }));
      else if (err.status === 429)
        setError(tc("login.tooMany", Math.max(1, Math.ceil((err.retryAfter ?? 300) / 60))));
      else setError(err.isNetwork ? t("common.offline") : t("common.loadError"));
      setBusy(false);
    }
  }

  let content;
  if (state.kind === "notFound") {
    content = (
      <section className="auth__card" aria-labelledby="join-title">
        <h1 className="auth__title" id="join-title">
          {t("join.notFoundTitle")}
        </h1>
        <p className="auth__intro">{t("join.notFound")}</p>
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
  } else if (account && state.invite.you === "gameMaster") {
    content = (
      <section className="auth__card" aria-labelledby="join-title">
        <h1 className="auth__title" id="join-title">
          {t("join.ownTitle")}
        </h1>
        <p className="auth__intro">{t("join.ownText")}</p>
        <ButtonLink href={`/campaigns/${encodeURIComponent(state.invite.campaign.id)}`} block>
          {t("join.toCampaign")}
        </ButtonLink>
      </section>
    );
  } else if (account && state.invite.you === "player") {
    content = (
      <section className="auth__card" aria-labelledby="join-title">
        <h1 className="auth__title" id="join-title">
          {t("join.alreadyTitle", { name: state.invite.campaign.name })}
        </h1>
        <ButtonLink href={`/new?campaign=${encodeURIComponent(state.invite.campaign.id)}`} icon="plus" block>
          {t("characters.new")}
        </ButtonLink>
        <ButtonLink href="/characters" variant="ghost">
          {t("menu.characters")}
        </ButtonLink>
      </section>
    );
  } else {
    const { invite } = state;
    const errorBox = error && (
      <Callout tone="danger" role="alert">
        {error}
      </Callout>
    );
    content = (
      <>
        {!registered && (
          <section className="auth__card" aria-labelledby="join-title">
            <h1 className="auth__title" id="join-title">
              {t("join.title", { gameMaster: invite.gameMaster.name, name: invite.campaign.name })}
            </h1>
            <p className="auth__intro">{t("join.text", { gameMaster: invite.gameMaster.name })}</p>
            {account && (
              <>
                {errorBox}
                <Button block busy={busy} busyLabel={t("join.joining")} onClick={() => void join()}>
                  {t("join.join")}
                </Button>
                <ButtonLink href="/characters" variant="ghost">
                  {t("join.notNow")}
                </ButtonLink>
              </>
            )}
          </section>
        )}
        {!account && (
          <>
            {errorBox}
            <GetStarted
              title={t("join.startTitle")}
              heading="h2"
              intro={t("join.startIntro")}
              onStarted={() => setRegistered(true)}
              onDone={(r) => {
                app.setAccount(r.account);
                setRegistered(false);
                void join();
              }}
              footer={
                <p className="auth__switch">
                  <ButtonLink href={`/login?next=${encodeURIComponent(path)}`} variant="ghost">
                    {t("login.havePassword")}
                  </ButtonLink>
                </p>
              }
            />
          </>
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
