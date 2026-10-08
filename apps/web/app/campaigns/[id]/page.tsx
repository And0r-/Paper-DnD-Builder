"use client";
/**
 * One campaign. The game master sees their own characters in it first,
 * then the invitation link with its QR code (AND-237) to send or show at
 * the table, and makes a new one if the old one went too far. They see each
 * player with their characters as cards, open or print them, build a new
 * one for a player, remove a player or delete the campaign. A player sees
 * only who leads it.
 *
 * The game master's page follows on its own: when a player joins or brings
 * a character, it shows up without reloading (AND-272). The page asks again
 * while it is in view, every little while and when it comes back into view;
 * a failed quiet ask changes nothing on screen.
 */
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../../src/ui/app-state.tsx";
import { api, ApiError, type CampaignPlayer, type CampaignView } from "../../../src/ui/api.ts";
import { CharacterCard, describeCharacter, packagesFor } from "../../../src/ui/characters.tsx";
import { Button, ButtonLink } from "../../../src/ui/components/Button.tsx";
import { ConfirmDialog } from "../../../src/ui/components/Dialog.tsx";
import { Callout, EmptyState, ErrorState, Loading } from "../../../src/ui/components/Feedback.tsx";
import { CopyText } from "../../../src/ui/components/CopyText.tsx";
import { Toast } from "../../../src/ui/components/Fields.tsx";
import { QrCode } from "../../../src/ui/components/QrCode.tsx";
import { AppShell } from "../../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../../src/ui/flow/frame.tsx";
import { RequireAccount } from "../../../src/ui/guards.tsx";
import type { LoadedPackage } from "../../../src/ui/packages.ts";

type Data = { lang: string; view: CampaignView; packages: Map<string, LoadedPackage> };

/** How often the game master's page asks again while in view. */
const FOLLOW_MS = 10_000;

async function loadCampaign(id: string, lang: string): Promise<Data> {
  const view = await api<CampaignView>("GET", `/api/campaigns/${encodeURIComponent(id)}`);
  const drafts = [...(view.characters ?? []), ...(view.players ?? []).flatMap((p) => p.characters)];
  return { lang, view, packages: await packagesFor(drafts, lang) };
}

export default function CampaignPage() {
  return <RequireAccount>{() => <CampaignScreen />}</RequireAccount>;
}

function CampaignScreen() {
  const { t, tc, lang } = useApp();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [loaded, setData] = useState<Data | null>(null);
  // Never show package words of the previous language.
  const data = loaded?.lang === lang ? loaded : null;
  const [failed, setFailed] = useState<"notFound" | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<CampaignPlayer>();
  const [askDelete, setAskDelete] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const [askRenew, setAskRenew] = useState(false);
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  usePageTitle([data?.view.campaign.name ?? "", t("campaigns.title")]);

  useEffect(() => {
    let live = true;
    loadCampaign(id, lang).then(
      (d) => live && (setData(d), setFailed(null)),
      (e) => live && setFailed(e instanceof ApiError && e.status === 404 ? "notFound" : "error"),
    );
    return () => {
      live = false;
    };
  }, [id, lang, attempt]);

  const reload = () => setAttempt((n) => n + 1);

  // Players and their characters arrive without reloading; only the game master sees them.
  const leads = data?.view.campaign.role === "gameMaster";
  // Counts the page's own changes: a quiet answer asked before one of them is old.
  const changes = useRef(0);
  useEffect(() => {
    if (!leads) return;
    let live = true;
    const ask = () => {
      if (document.visibilityState !== "visible") return;
      const asked = changes.current;
      loadCampaign(id, lang).then(
        (d) => live && asked === changes.current && setData(d),
        () => undefined,
      );
    };
    const timer = setInterval(ask, FOLLOW_MS);
    document.addEventListener("visibilitychange", ask);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [leads, id, lang]);

  async function renew() {
    setBusy(true);
    setError(undefined);
    try {
      changes.current++;
      const { inviteUrl } = await api<{ inviteUrl: string }>("POST", `/api/campaigns/${id}/invite`);
      setData((d) => d && { ...d, view: { ...d.view, campaign: { ...d.view.campaign, inviteUrl } } });
      setToast(t("campaign.renewed"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 429)
        setError(tc("campaign.tooFast", Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60))));
      else setError(e instanceof ApiError && e.isNetwork ? t("common.offline") : t("common.loadError"));
    } finally {
      setBusy(false);
      setAskRenew(false);
    }
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
            {campaign.inviteUrl && (
              <section className="campaign-page__section invite" aria-labelledby="p-invite">
                <h2 className="section-title" id="p-invite">
                  {t("campaign.inviteTitle")}
                </h2>
                <div className="invite__body">
                  <div className="invite__link">
                    <p>{t("campaign.inviteText")}</p>
                    <CopyText label={t("campaign.inviteLabel")} value={campaign.inviteUrl} />
                    <Button variant="ghost" icon="refresh" onClick={() => setAskRenew(true)}>
                      {t("campaign.renew")}
                    </Button>
                  </div>
                  <QrCode value={campaign.inviteUrl} label={t("campaign.inviteQr")} />
                </div>
              </section>
            )}
            <section className="campaign-page__section" aria-labelledby="p-players">
              <h2 className="section-title" id="p-players">
                {t("campaign.players")}
              </h2>
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
                                helpOut
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
            changes.current++;
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

      <ConfirmDialog
        open={askRenew}
        title={t("campaign.renewTitle")}
        confirmLabel={t("campaign.renew")}
        busy={busy}
        onCancel={() => setAskRenew(false)}
        onConfirm={renew}
      >
        <p>{t("campaign.renewText")}</p>
      </ConfirmDialog>

      {toast && <Toast message={toast} duration={6000} onDone={() => setToast(undefined)} />}
    </AppShell>
  );
}
