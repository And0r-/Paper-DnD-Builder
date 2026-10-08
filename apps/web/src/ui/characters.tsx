"use client";
/**
 * A character as a card: name, the package's summary line (what it is and
 * its level), where it stands, and what one can do with it. Shared by
 * "My characters" and the campaign page of a game master.
 */
import { evaluateDraft } from "@builder/core";
import type { Translator } from "../i18n/index.ts";
import { useApp } from "./app-state.tsx";
import type { DraftListEntry } from "./api.ts";
import { Button, ButtonLink } from "./components/Button.tsx";
import { Icon } from "./components/Icon.tsx";
import { Menu, MenuSeparator } from "./components/Menu.tsx";
import { firstOpen, progressOf } from "./flow/model.ts";
import { flowOf } from "./flow/raise.ts";
import { levelWord, measureContext, plain, ptext, thingName } from "./package-text.ts";
import { loadPackage, type LoadedPackage } from "./packages.ts";

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
  for (const id of new Set(drafts.filter((d) => d.packageAvailable).map((d) => d.packageId))) {
    packages.set(id, await loadPackage(id, lang));
  }
  return packages;
}

export function describeCharacter(
  d: DraftListEntry,
  lp: LoadedPackage | undefined,
  t: Translator["t"],
): CharacterItem {
  const name = d.summary?.name || t("common.unnamed");
  if (!lp)
    return { id: d.id, name, line: "", finished: false, status: t("characters.packageMissing"), href: "" };
  const doc = {
    level: d.level,
    answers: d.answers,
    ...(d.levelBefore !== null && { levelBefore: d.levelBefore }),
  };
  const ev = evaluateDraft(lp.pkg, doc);
  const { entries, raise } = flowOf(d.id, lp, doc, ev, t);
  const finished = d.status === "finished" && ev.complete;
  // The line only makes sense once everything it names is chosen.
  const vars: Record<string, string | number> = {};
  let whole = true;
  for (const [k, v] of Object.entries(d.summary?.line ?? {})) {
    if (v === null) whole = false;
    else vars[k] = typeof v === "string" ? thingName(lp, v) : v;
  }
  const ctx = measureContext(lp, undefined);
  const p = progressOf(entries);
  return {
    id: d.id,
    name,
    line: whole ? plain(ctx, ptext(lp, "summary.line"), vars) : "",
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
}: {
  item: CharacterItem;
  onDelete?: (() => void) | undefined;
  /** h3 where the cards stand under a heading of their own (h4 under a player in a campaign). */
  heading?: "h2" | "h3" | "h4";
}) {
  const { t } = useApp();
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
            aria-label={`${item.finished ? t("characters.view") : t("characters.continue")}: ${item.name}`}
          >
            {item.finished ? t("characters.view") : t("characters.continue")}
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
