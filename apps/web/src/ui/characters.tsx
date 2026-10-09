"use client";
/**
 * A character as a card: name, the package's summary line (what it is and
 * its level), where it stands, and what one can do with it. Shared by
 * "My characters" and the campaign page of a game master.
 */
import { evaluateDraft, tracksText, type DraftSummary } from "@builder/core";
import type { Translator } from "../i18n/index.ts";
import { useApp } from "./app-state.tsx";
import type { DraftListEntry } from "./api.ts";
import { Button, ButtonLink } from "./components/Button.tsx";
import { Icon } from "./components/Icon.tsx";
import { Menu, MenuSeparator } from "./components/Menu.tsx";
import { firstOpen, progressOf, type LeadStep } from "./flow/model.ts";
import { flowOf } from "./flow/raise.ts";
import { levelWord, measureContext, plain, ptext, thingName } from "./package-text.ts";
import { draftPackageKey, loadPackage, type LoadedPackage } from "./packages.ts";

export interface CharacterItem {
  id: string;
  name: string;
  line: string;
  finished: boolean;
  status: string;
  href: string;
  doneHref?: string;
  /** Back into the builder, for a finished character (the sheet's "To the builder"). */
  editHref?: string | undefined;
  raiseHref?: string | undefined;
  /** The campaign it belongs to, by name, where the list mixes campaigns ("My characters"). */
  campaign?: string | undefined;
}

/** The packages of every listed draft whose package is loaded, in the screen language. */
export async function packagesFor(drafts: DraftListEntry[], lang: string) {
  const packages = new Map<string, LoadedPackage>();
  for (const id of new Set(drafts.filter((d) => d.packageAvailable).map(draftPackageKey))) {
    packages.set(id, await loadPackage(id, lang));
  }
  return packages;
}

export function describeCharacter(
  d: DraftListEntry,
  lp: LoadedPackage | undefined,
  t: Translator["t"],
  /** The builder's steps before the game, as the character's flow has them (the campaign). */
  leads: readonly LeadStep[] = [],
): CharacterItem {
  const name = d.summary?.name || t("common.unnamed");
  if (!lp)
    return { id: d.id, name, line: "", finished: false, status: t("characters.packageMissing"), href: "" };
  const doc = {
    level: d.level,
    answers: d.answers,
    ...(d.levelBefore !== null && { levelBefore: d.levelBefore }),
    ...(d.tracks !== undefined && d.tracks.length > 0 && { tracks: d.tracks }),
  };
  const ev = evaluateDraft(lp.pkg, doc);
  const { entries, raise } = flowOf(d.id, lp, doc, ev, t, leads);
  const finished = d.status === "finished" && ev.complete;
  const p = progressOf(entries);
  return {
    id: d.id,
    name,
    line: summaryLineText(lp, d.summary?.line ?? {}),
    finished,
    status: finished
      ? t("characters.finished")
      : raise
        ? t("characters.raising", { ...p, levelName: levelWord(lp), level: raise.to })
        : t("characters.progress", p),
    href: finished ? `/c/${d.id}/bogen` : firstOpen(entries).href,
    doneHref: `/c/${d.id}/done`,
    editHref: finished ? `/c/${d.id}/overview` : undefined,
    // A finished character below the highest level can go up.
    raiseHref: finished && ev.level < lp.pkg.flow.level.max ? `/c/${d.id}/raise` : undefined,
  };
}

/**
 * A finished character shows "View" and "Print"; editing and raising sit in
 * the "more" menu (AND-228). Without `onDelete` the menu has no "Delete": a
 * game master may change a player's character, not delete it.
 */
export function CharacterCard({
  item,
  onDelete,
  heading: Heading = "h2",
  helpOut,
}: {
  item: CharacterItem;
  onDelete?: (() => void) | undefined;
  /** A player's character in the game master's campaign: "Help out" builds along, live (AND-246). */
  helpOut?: boolean;
  /** h3 where the cards stand under a heading of their own (h4 under a player in a campaign). */
  heading?: "h2" | "h3" | "h4";
}) {
  const { t } = useApp();
  const open = helpOut ? t("characters.helpOut") : t("characters.continue");
  return (
    <article className="character">
      <div className="character__main">
        <Heading className="character__name">{item.name}</Heading>
        {item.line && <p className="character__line">{item.line}</p>}
        {item.campaign && (
          <p className="character__campaign">{t("characters.campaign", { name: item.campaign })}</p>
        )}
        <p className={`character__status${item.finished ? " character__status--done" : ""}`}>
          {item.finished && <Icon name="check" size={18} />}
          <span>{item.status}</span>
        </p>
      </div>
      <div className="character__actions">
        {item.href && (
          <ButtonLink
            href={item.href}
            variant={item.finished ? "secondary" : "primary"}
            {...(!item.finished && helpOut ? { icon: "people" as const } : {})}
            aria-label={`${item.finished ? t("characters.view") : open}: ${item.name}`}
          >
            {item.finished ? t("characters.view") : open}
          </ButtonLink>
        )}
        {item.finished && item.doneHref && (
          <ButtonLink
            href={item.doneHref}
            variant="secondary"
            icon="printer"
            aria-label={`${t("characters.print")}: ${item.name}`}
          >
            {t("characters.print")}
          </ButtonLink>
        )}
        {(item.editHref || item.raiseHref || onDelete) && (
          <Menu label={t("characters.more", { name: item.name })}>
            {item.editHref && (
              <ButtonLink href={item.editHref} variant="ghost" icon="pencil" role="menuitem" tabIndex={-1}>
                {t("characters.edit")}
              </ButtonLink>
            )}
            {item.raiseHref && (
              <ButtonLink
                href={item.raiseHref}
                variant="ghost"
                icon="arrowUp"
                role="menuitem"
                tabIndex={-1}
                aria-label={t("raise.buttonLabel", { name: item.name })}
              >
                {t("raise.button")}
              </ButtonLink>
            )}
            {onDelete && (item.editHref || item.raiseHref) && <MenuSeparator />}
            {onDelete && (
              <Button
                variant="ghost"
                className="btn--danger-text"
                role="menuitem"
                tabIndex={-1}
                onClick={onDelete}
              >
                {t("characters.delete")}
              </Button>
            )}
          </Menu>
        )}
      </div>
    </article>
  );
}

/**
 * The package's line about a character ("Lantern bearer 3 / Herbalist 2 ·
 * level 5"), or "" while something it names is not chosen yet.
 */
export function summaryLineText(lp: LoadedPackage, line: DraftSummary["line"]): string {
  const vars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(line)) {
    if (v === null) return "";
    vars[k] =
      typeof v === "string"
        ? thingName(lp, v)
        : typeof v === "number"
          ? v
          : tracksText(v, (id) => thingName(lp, id));
  }
  return plain(measureContext(lp, undefined), ptext(lp, "summary.line"), vars);
}
