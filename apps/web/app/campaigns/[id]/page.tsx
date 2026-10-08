"use client";
/**
 * One campaign. The game master sees their own characters in it first,
 * adds players by mail address (the hint
 * says who gets which mail), sees each player with their characters as
 * cards, opens or prints them, builds a new one for a player, removes a
 * player or deletes the campaign. A player sees only who leads it.
 */
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "../../../src/ui/app-state.tsx";
import { api, ApiError, type CampaignPlayer, type CampaignView } from "../../../src/ui/api.ts";
import { CharacterCard, describeCharacter, packagesFor } from "../../../src/ui/characters.tsx";
import { Button, ButtonLink } from "../../../src/ui/components/Button.tsx";
import { ConfirmDialog } from "../../../src/ui/components/Dialog.tsx";
import { Callout, EmptyState, ErrorState, Loading } from "../../../src/ui/components/Feedback.tsx";
import { TextField, Toast } from "../../../src/ui/components/Fields.tsx";
import { AppShell } from "../../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../../src/ui/flow/frame.tsx";
import { RequireAccount } from "../../../src/ui/guards.tsx";
import type { LoadedPackage } from "../../../src/ui/packages.ts";

/** The server's own check (see accounts.ts), so most typing errors show before sending. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Data = { lang: string; view: CampaignView; packages: Map<string, LoadedPackage> };

export default function CampaignPage() {
  return <RequireAccount>{(account) => <CampaignScreen me={account.name} />}</RequireAccount>;
}

/** `me`: the game master's name, as the added player's mail shows it. */
function CampaignScreen({ me }: { me: string }) {
  const { t, tc, lang } = useApp();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [loaded, setData] = useState<Data | null>(null);
  // Never show package words of the previous language.
  const data = loaded?.lang === lang ? loaded : null;
  const [failed, setFailed] = useState<"notFound" | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<CampaignPlayer>();
  const [askDelete, setAskDelete] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  usePageTitle([data?.view.campaign.name ?? "", t("campaigns.title")]);

  useEffect(() => {
    let live = true;
    (async () => {
      const view = await api<CampaignView>("GET", `/api/campaigns/${encodeURIComponent(id)}`);
      const drafts = [...(view.characters ?? []), ...(view.players ?? []).flatMap((p) => p.characters)];
      return { lang, view, packages: await packagesFor(drafts, lang) };
    })().then(
      (d) => live && (setData(d), setFailed(null)),
      (e) => live && setFailed(e instanceof ApiError && e.status === 404 ? "notFound" : "error"),
    );
    return () => {
      live = false;
    };
  }, [id, lang, attempt]);

  const reload = () => setAttempt((n) => n + 1);

  async function add() {
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) {
      setEmailError(t("login.emailInvalid"));
      return;
    }
    setBusy(true);
    setEmailError(undefined);
    try {
      const r = await api<{ player: { name: string } }>("POST", `/api/campaigns/${id}/players`, {
        email: address,
        language: lang,
      });
      setEmail("");
      setToast(t("campaign.added", { name: r.player.name }));
      reload();
    } catch (e) {
      setEmailError(addError(e, address));
    } finally {
      setBusy(false);
    }
  }

  function addError(e: unknown, address: string): string {
    if (!(e instanceof ApiError)) return t("common.loadError");
    if (e.isNetwork) return t("common.offline");
    switch (e.code) {
      case "alreadyPlayer":
        return t("campaign.alreadyPlayer", { email: address });
      case "cannotAddYourself":
        return t("campaign.cannotAddYourself");
      case "tooManyPlayers":
        return t("campaign.tooManyPlayers", { max: Number(e.details["max"]) });
      case "mailFailed":
        return t("campaign.mailFailed");
      case "mailNotConfigured":
        return t("campaign.mailNotConfigured");
    }
    if (e.status === 429) return tc("campaign.tooFast", Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60)));
    if (e.status === 400) return t("login.emailInvalid");
    return t("common.loadError");
  }

  let content;
  if (failed === "notFound") {
    content = (
      <EmptyState title={t("campaign.notFound")}>
        <ButtonLink href="/campaigns">{t("menu.campaigns")}</ButtonLink>
      </EmptyState>
    );
  } else if (failed) {
    content = <ErrorState onRetry={reload} />;
  } else if (!data) {
    content = <Loading shape="cards" count={3} />;
  } else {
    const { campaign, characters, players } = data.view;
    content = (
      <>
        <h1 className="page__title">{campaign.name}</h1>
        {players === null ? (
          <>
            <Callout tone="info" title={t("campaign.playerTitle", { name: campaign.gameMaster.name })}>
              <p>{t("campaign.playerText")}</p>
            </Callout>
            <div className="page-actions">
              <ButtonLink href="/characters">{t("campaign.toCharacters")}</ButtonLink>
              <Button variant="ghost" onClick={() => setAskLeave(true)}>
                {t("campaigns.leave")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>{t("campaign.youLead")}</p>
            {characters && characters.length > 0 && (
              <section className="campaign-page__section" aria-labelledby="p-mine">
                <h2 className="section-title" id="p-mine">
                  {t("campaign.mine")}
                </h2>
                <ul className="character-list">
                  {characters.map((d) => (
                    <li key={d.id}>
                      <CharacterCard
                        heading="h3"
                        item={describeCharacter(d, data.packages.get(d.packageId), t)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="campaign-page__section" aria-labelledby="p-players">
              <h2 className="section-title" id="p-players">
                {t("campaign.players")}
              </h2>
              <form
                className="campaigns__new"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void add();
                }}
              >
                <TextField
                  label={t("campaign.addLabel")}
                  help={t("campaign.addHelp", { gameMaster: me, name: campaign.name })}
                  error={emailError}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.currentTarget.value);
                    if (emailError) setEmailError(undefined);
                  }}
                />
                <Button type="submit" icon="mail" busy={busy} busyLabel={t("campaign.adding")}>
                  {t("campaign.add")}
                </Button>
              </form>
              {players.length === 0 ? (
                <p className="note">{t("campaign.noPlayers")}</p>
              ) : (
                <ul className="player-list">
                  {players.map((p) => (
                    <li key={p.id} className="player">
                      <div className="player__head">
                        <h3 className="player__name">{p.name}</h3>
                        <Button
                          variant="ghost"
                          aria-label={t("campaign.removeLabel", { name: p.name })}
                          onClick={() => setRemove(p)}
                        >
                          {t("campaign.remove")}
                        </Button>
                      </div>
                      {p.characters.length === 0 ? (
                        <p className="note">{t("campaign.noCharacters")}</p>
                      ) : (
                        <ul className="character-list">
                          {p.characters.map((d) => (
                            <li key={d.id}>
                              <CharacterCard
                                heading="h4"
                                item={describeCharacter(d, data.packages.get(d.packageId), t)}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                      <ButtonLink
                        href={`/new?campaign=${campaign.id}&player=${p.id}`}
                        variant="secondary"
                        icon="plus"
                        className="player__build"
                      >
                        {t("campaign.buildFor", { name: p.name })}
                      </ButtonLink>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="settings__section settings__section--danger" aria-labelledby="p-delete">
              <h2 className="section-title" id="p-delete">
                {t("campaign.delete")}
              </h2>
              <p>{t("campaign.deleteText")}</p>
              <Button variant="danger" onClick={() => setAskDelete(true)}>
                {t("campaign.delete")}
              </Button>
            </section>
          </>
        )}
      </>
    );
  }

  const name = data?.view.campaign.name ?? "";
  return (
    <AppShell>
      <div className="page campaign-page">
        <ButtonLink href="/campaigns" variant="ghost" icon="arrowLeft" className="campaign-page__back">
          {t("menu.campaigns")}
        </ButtonLink>
        <div aria-live="polite">
          {error && (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          )}
        </div>
        {content}
      </div>

      <ConfirmDialog
        open={remove !== undefined}
        title={t("campaign.removeTitle", { name: remove?.name ?? "" })}
        confirmLabel={t("campaign.remove")}
        danger
        busy={busy}
        onCancel={() => setRemove(undefined)}
        onConfirm={async () => {
          const p = remove!;
          setBusy(true);
          setError(undefined);
          try {
            await api("DELETE", `/api/campaigns/${id}/players/${p.id}`);
            setToast(t("campaign.removed", { name: p.name }));
          } catch (e) {
            // Already gone (another tab): reloading shows the list as it is.
            if (!(e instanceof ApiError && e.code === "playerNotFound")) setError(t("common.loadError"));
          } finally {
            setBusy(false);
            setRemove(undefined);
            reload();
          }
        }}
      >
        <p>{t("campaign.removeText")}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={askDelete}
        title={t("campaign.deleteTitle", { name })}
        confirmLabel={t("campaign.delete")}
        danger
        busy={busy}
        onCancel={() => setAskDelete(false)}
        onConfirm={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await api("DELETE", `/api/campaigns/${id}`);
            router.push("/campaigns");
          } catch {
            setError(t("common.loadError"));
            setBusy(false);
            setAskDelete(false);
          }
        }}
      >
        <p>{t("campaign.deleteText")}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={askLeave}
        title={t("campaigns.leaveTitle", { name })}
        confirmLabel={t("campaigns.leave")}
        danger
        busy={busy}
        onCancel={() => setAskLeave(false)}
        onConfirm={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await api("DELETE", `/api/campaigns/${id}/players/me`);
            router.push("/campaigns");
          } catch {
            setError(t("common.loadError"));
            setBusy(false);
            setAskLeave(false);
          }
        }}
      >
        <p>{t("campaigns.leaveText")}</p>
      </ConfirmDialog>

      {toast && <Toast message={toast} duration={6000} onDone={() => setToast(undefined)} />}
    </AppShell>
  );
}
