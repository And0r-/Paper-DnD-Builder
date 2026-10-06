"use client";
/**
 * The end (flow spec 4.7). It shapes the memory of everything before it:
 * calm, clear, and the printout one tap away. No confetti.
 *
 * After a level up (`?from=<old level>`) it names the new level and, in two
 * or three lines, what came with it: new things and the numbers that changed.
 */
import { cardCount } from "@builder/sheet/cards";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { Button, ButtonLink } from "../../../../src/ui/components/Button.tsx";
import { EmptyState } from "../../../../src/ui/components/Feedback.tsx";
import { Explained } from "../../../../src/ui/components/Explained.tsx";
import { Icon } from "../../../../src/ui/components/Icon.tsx";
import { fillNodes, listNodes, ThingName } from "../../../../src/ui/components/ThingName.tsx";
import { useDraft } from "../../../../src/ui/flow/draft-state.tsx";
import { usePageTitle } from "../../../../src/ui/flow/frame.tsx";
import { Origins } from "../../../../src/ui/flow/origins.tsx";
import { PrintDialog } from "../../../../src/ui/flow/print-dialog.tsx";
import { levelGrowth } from "../../../../src/ui/flow/explain.ts";
import { evaluateBefore, raiseNews } from "../../../../src/ui/flow/raise.ts";
import { formatValue, levelWord, ptext, thingName } from "../../../../src/ui/package-text.ts";
import { useMeasure } from "../../../../src/ui/components/RichText.tsx";

/** At most this many names in one line of news; the rest is counted. */
const NEWS_MAX = 6;

export default function DonePage() {
  const { t, list } = useApp();
  const { lp, ev, doc, draft } = useDraft();
  const ctx = useMeasure(lp);
  const params = useSearchParams();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [printing, setPrinting] = useState(false);
  const nameState = ev.choices[lp.pkg.flow.characterName];
  const name = (nameState?.answer as { text?: string } | undefined)?.text?.trim();
  const levelName = ptext(lp, "level.name") ?? "";
  const fromParam = Number(params.get("from"));
  const from =
    Number.isInteger(fromParam) && fromParam >= lp.pkg.flow.level.min && fromParam < ev.level
      ? fromParam
      : undefined;
  const title =
    from === undefined
      ? name
        ? t("done.title", { name })
        : t("done.titleUnnamed")
      : name
        ? t("done.raisedTitle", { name, levelName: levelWord(lp), level: ev.level })
        : t("done.raisedTitleUnnamed", { levelName: levelWord(lp), level: ev.level });
  // What the level up brought: the main numbers and those that grow with the level.
  const news = useMemo(() => {
    if (from === undefined) return undefined;
    const growth = levelGrowth(lp, ev);
    const ids = [
      ...new Set([...lp.pkg.flow.summary.fields, ...growth.own, ...growth.byThing.flatMap((g) => g.values)]),
    ].filter((id) => ptext(lp, `value.${id}.name`) !== undefined);
    return raiseNews(evaluateBefore(lp.pkg, doc, from), ev, ids);
  }, [from, lp, ev, doc]);
  const capped = (items: string[]) =>
    list(
      items.length > NEWS_MAX
        ? [...items.slice(0, NEWS_MAX - 1), t("done.moreItems", { count: items.length - NEWS_MAX + 1 })]
        : items,
    );
  // The same with names that explain themselves.
  const cappedNodes = (items: ReactNode[]) =>
    listNodes(
      t,
      items.length > NEWS_MAX
        ? [...items.slice(0, NEWS_MAX - 1), t("done.moreItems", { count: items.length - NEWS_MAX + 1 })]
        : items,
    );
  const canRaise = ev.level < lp.pkg.flow.level.max;
  // A game master built this for a player: say whose it is, and lead back to the campaigns.
  const forPlayer = draft.access === "gameMaster";
  usePageTitle([title]);
  // Only promise cards when the PDF has some: not every character has things that are cards.
  const hasCards = useMemo(() => cardCount(lp.pkg, ev) > 0, [lp.pkg, ev]);
  useEffect(() => headingRef.current?.focus(), []);

  if (draft.status !== "finished") {
    return (
      <div className="page">
        <EmptyState title={t("done.notFinished")}>
          <ButtonLink href={`/c/${draft.id}/overview`}>{t("done.toOverview")}</ButtonLink>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page done">
      <Icon name="check" size={56} className="done__icon" />
      <h1 className="done__title" tabIndex={-1} ref={headingRef}>
        {title}
      </h1>
      {forPlayer && <p className="done__owner">{t("done.forPlayer", { email: draft.owner.email })}</p>}
      {news && (
        <div className="done__news">
          {params.get("asked") === "0" && <p>{t("done.raisedNothing", { levelName, level: ev.level })}</p>}
          {news.things.length > 0 && (
            <p>
              {fillNodes((m) => t("done.newThings", m), {
                things: cappedNodes(
                  news.things
                    .filter((id) => thingName(lp, id))
                    .map((id) => <ThingName key={id} lp={lp} id={id} />),
                ),
              })}
            </p>
          )}
          {news.values.length > 0 && (
            <p>
              {t("done.newValues", {
                values: capped(
                  news.values.map((v) =>
                    t("done.valueChange", {
                      name: ptext(lp, `value.${v.id}.name`) ?? v.id,
                      after: formatValue(lp, ctx, v.id, v.after),
                      before: formatValue(lp, ctx, v.id, v.before),
                    }),
                  ),
                ),
              })}
            </p>
          )}
        </div>
      )}
      <p className="done__text">
        {from !== undefined ? t("done.reprint") : t(hasCards ? "done.text" : "done.textSheetOnly")}
      </p>
      <div className="done__pdf">
        <Explained hint={t("done.pdfHint")} block>
          {/* A dialog picks what goes into the PDF: the sheet, the cards, the rules texts. */}
          <Button icon="printer" block aria-haspopup="dialog" onClick={() => setPrinting(true)}>
            {t("done.download")}
          </Button>
        </Explained>
        <PrintDialog
          open={printing}
          onClose={() => setPrinting(false)}
          draftId={draft.id}
          name={name}
          hasCards={hasCards}
        />
        <p className="done__tip">{t(hasCards ? "done.tip" : "done.tipSheetOnly")}</p>
      </div>
      <Origins />
      <p className="note">{t("done.editHint")}</p>
      <div className="done__next">
        {canRaise && (
          <ButtonLink href={`/c/${draft.id}/raise`} variant="secondary" icon="arrowUp">
            {t("raise.button")}
          </ButtonLink>
        )}
        {forPlayer ? (
          <ButtonLink href="/campaigns" variant="secondary">
            {t("menu.campaigns")}
          </ButtonLink>
        ) : (
          <>
            <ButtonLink href="/characters" variant="secondary">
              {t("done.toList")}
            </ButtonLink>
            <ButtonLink href="/new" variant="secondary" icon="plus">
              {t("done.another")}
            </ButtonLink>
          </>
        )}
      </div>
    </div>
  );
}
