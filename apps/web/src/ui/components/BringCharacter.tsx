"use client";
/**
 * "Which character are you bringing?" (AND-272), right after joining a
 * campaign from its invitation, and again for someone who plays there
 * already. A newcomer to the campaign often has a character finished;
 * making a new, empty one for them left an "Unnamed" in their list and in
 * the game master's, while the real one stayed outside.
 *
 * One question, one list: the own characters not yet in this campaign,
 * finished ones first, and "Make a new character" last. The default is
 * the newest finished character in no campaign (one in another campaign
 * is never moved without a tap). With no character to bring, a new one it
 * is: right after joining, straight on; otherwise the plain links.
 *
 * Bringing one moves it into the campaign at once (the same as the
 * campaign field in the overview, where it can be changed back) and says
 * so on this page: what happened, and that the game master sees it now.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useApp } from "../app-state.tsx";
import { api, type Campaign, type DraftListEntry } from "../api.ts";
import { describeCharacter, packagesFor, type CharacterItem } from "../characters.tsx";
import type { LoadedPackage } from "../packages.ts";
import { Button, ButtonLink } from "./Button.tsx";
import { Callout, Loading } from "./Feedback.tsx";
import { Icon } from "./Icon.tsx";

const NEW = "new";

interface Candidate {
  item: CharacterItem;
  /** The other campaign it plays in now; null for none. */
  from: string | null;
  inCampaign: boolean;
}

interface Loaded {
  lang: string;
  drafts: DraftListEntry[];
  packages: Map<string, LoadedPackage>;
  /** Campaign names by id; empty if they could not be loaded. */
  names: Map<string, string>;
}

type State =
  | { kind: "loading" }
  | { kind: "choose"; loaded: Loaded }
  | { kind: "none" }
  | { kind: "brought"; name: string; href: string }
  | { kind: "failed" };

export function BringCharacter({
  campaign,
  joined,
  headingLevel = "h1",
}: {
  campaign: { id: string; name: string };
  /** Just joined: say so once, and go straight on to a new character when there is none to bring. */
  joined: boolean;
  headingLevel?: "h1" | "h2";
}) {
  const { t, lang } = useApp();
  const router = useRouter();
  const Heading = headingLevel;
  const headingId = useId();
  const group = useId();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [picked, setPick] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const newHref = `/new?campaign=${encodeURIComponent(campaign.id)}${joined ? "&joined" : ""}`;

  useEffect(() => {
    let live = true;
    (async () => {
      const [{ drafts }, names] = await Promise.all([
        api<{ drafts: DraftListEntry[] }>("GET", "/api/drafts"),
        api<{ campaigns: Campaign[] }>("GET", "/api/campaigns").then(
          (r) => new Map(r.campaigns.map((c) => [c.id, c.name])),
          () => new Map<string, string>(),
        ),
      ]);
      const mine = drafts.filter(
        (d) => d.access === "owner" && d.packageAvailable && d.campaignId !== campaign.id,
      );
      return { lang, drafts: mine, packages: await packagesFor(mine, lang), names };
    })().then(
      (loaded) => {
        if (!live) return;
        if (loaded.drafts.length > 0) setState({ kind: "choose", loaded });
        else if (joined) router.replace(newHref);
        else setState({ kind: "none" });
      },
      () => live && setState({ kind: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [campaign.id, joined, lang, router, newHref, attempt]);

  const candidates: Candidate[] =
    state.kind === "choose"
      ? state.loaded.drafts
          .map((d) => ({
            item: describeCharacter(d, state.loaded.packages.get(d.packageId), t),
            from: d.campaignId ? (state.loaded.names.get(d.campaignId) ?? null) : null,
            inCampaign: d.campaignId !== null,
            updatedAt: d.updatedAt,
          }))
          .sort(
            (a, b) =>
              Number(b.item.finished) - Number(a.item.finished) || b.updatedAt.localeCompare(a.updatedAt),
          )
      : [];
  // The newest finished one in no campaign; else nothing is moved without a tap.
  const pick = picked ?? candidates.find((c) => c.item.finished && !c.inCampaign)?.item.id ?? NEW;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (state.kind !== "choose") return;
    if (pick === NEW) {
      router.push(newHref);
      return;
    }
    const chosen = candidates.find((c) => c.item.id === pick)!;
    setBusy(true);
    setError(undefined);
    try {
      await api("PUT", `/api/drafts/${encodeURIComponent(pick)}/campaign`, { campaignId: campaign.id });
      setState({ kind: "brought", name: chosen.item.name, href: `/c/${encodeURIComponent(pick)}/overview` });
    } catch {
      setError(t("common.loadError"));
    } finally {
      setBusy(false);
    }
  }

  // Never show package words of the previous language.
  if (state.kind === "loading" || (state.kind === "choose" && state.loaded.lang !== lang))
    return <Loading shape="page" count={2} />;
  if (state.kind === "failed") {
    return (
      <Callout tone="danger" role="alert">
        <p>{t("common.loadError")}</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {t("common.retry")}
        </Button>
      </Callout>
    );
  }
  if (state.kind === "none") {
    return (
      <>
        <ButtonLink href={newHref} icon="plus" block>
          {t("characters.new")}
        </ButtonLink>
        <ButtonLink href="/characters" variant="ghost">
          {t("menu.characters")}
        </ButtonLink>
      </>
    );
  }
  if (state.kind === "brought") {
    return (
      <section className="bring" aria-labelledby={headingId}>
        <Callout tone="success" role="status">
          <Heading className="bring__done-title" id={headingId}>
            {t("join.broughtTitle", { character: state.name, name: campaign.name })}
          </Heading>
          <p>{t("join.broughtText")}</p>
        </Callout>
        <ButtonLink href={state.href} block>
          {t("join.toCharacter")}
        </ButtonLink>
        <ButtonLink href="/characters" variant="ghost">
          {t("menu.characters")}
        </ButtonLink>
      </section>
    );
  }

  return (
    <form className="bring" aria-labelledby={headingId} onSubmit={(e) => void submit(e)} noValidate>
      {joined && (
        <Callout tone="success" role="status">
          {t("new.joined", { name: campaign.name })}
        </Callout>
      )}
      <Heading className={headingLevel === "h1" ? "auth__title" : "section-title"} id={headingId}>
        {t("join.bringTitle")}
      </Heading>
      <p className="auth__intro">{t("join.bringIntro")}</p>
      <fieldset className="options__list bring__list" aria-labelledby={headingId}>
        {candidates.map((c) => (
          <Choice
            key={c.item.id}
            group={group}
            value={c.item.id}
            checked={pick === c.item.id}
            onPick={setPick}
            title={c.item.name}
          >
            {c.item.line && <span className="bring__line">{c.item.line}</span>}
            <span className={`bring__status${c.item.finished ? " bring__status--done" : ""}`}>
              {c.item.finished && <Icon name="check" size={18} />}
              <span>{c.item.status}</span>
            </span>
            {c.inCampaign && (
              <span className="bring__moves">
                {c.from
                  ? t("join.bringMoves", { from: c.from, to: campaign.name })
                  : t("join.bringMovesUnknown", { to: campaign.name })}
              </span>
            )}
          </Choice>
        ))}
        <Choice
          group={group}
          value={NEW}
          checked={pick === NEW}
          onPick={setPick}
          title={t("join.bringNew")}
          icon="plus"
        >
          <span className="bring__line">{t("join.bringNewText", { name: campaign.name })}</span>
        </Choice>
      </fieldset>
      {error && (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      )}
      <Button type="submit" block busy={busy} busyLabel={t("join.bringSaving")}>
        {pick === NEW ? t("join.bringNewGo") : t("join.bringGo")}
      </Button>
      <ButtonLink href="/characters" variant="ghost">
        {t("join.bringLater")}
      </ButtonLink>
    </form>
  );
}

/** One radio card, the whole card picks it (as the options in a step). */
function Choice({
  group,
  value,
  checked,
  onPick,
  title,
  icon,
  children,
}: {
  group: string;
  value: string;
  checked: boolean;
  onPick: (v: string) => void;
  title: string;
  icon?: "plus";
  children: React.ReactNode;
}) {
  const id = `${group}-${value}`;
  return (
    <div
      className={`option option--compact bring__option${checked ? " option--checked" : ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("input, label")) return;
        onPick(value);
      }}
    >
      <div className="option__head">
        <input
          className="option__input"
          type="radio"
          id={id}
          name={group}
          value={value}
          checked={checked}
          onChange={() => onPick(value)}
          aria-describedby={`${id}-more`}
        />
        <span className="option__mark" aria-hidden="true">
          {checked && <Icon name="dot" size={14} />}
        </span>
        <label className="option__name" htmlFor={id}>
          {icon && <Icon name={icon} size={20} />} {title}
        </label>
      </div>
      <p className="bring__more" id={`${id}-more`}>
        {children}
      </p>
    </div>
  );
}
