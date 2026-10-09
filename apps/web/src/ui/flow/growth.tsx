"use client";
/**
 * "What grows with your level": numbers that follow the level alone, each
 * with the reason ("6, because level 20"), and the numbers a thing raises
 * by level (places per rank), grouped under that thing. On the overview,
 * next to the main values, so a number on the sheet is never a riddle.
 */
import { headTracks } from "@builder/core";
import { useId, type ReactNode } from "react";
import { useApp } from "../app-state.tsx";
import { RichText, useMeasure } from "../components/RichText.tsx";
import { fillNodes, ThingLabel } from "../components/ThingName.tsx";
import { formatValue, levelWord, ptext, thingName } from "../package-text.ts";
import { useDraft } from "./draft-state.tsx";
import { levelGrowth } from "./explain.ts";

export function LevelGrowth() {
  const { t } = useApp();
  const { lp, ev } = useDraft();
  const ctx = useMeasure(lp);
  const id = useId();
  const growth = levelGrowth(lp, ev);
  if (growth.own.length === 0 && growth.byThing.length === 0) return null;
  const word = levelWord(lp);
  const because = t("growth.because", { levelName: word, level: ev.level });
  // With more than one track (concept AND-262, 6.4): what follows the whole
  // character first, then a block per track, most levels first.
  const split = (ev.tracks?.list.length ?? 0) > 1;
  const whole = growth.byThing.filter((g) => g.track === undefined);
  return (
    <section className="growth" aria-labelledby={id}>
      <h2 className="section-title" id={id}>
        {t("growth.title", { levelName: word })}
      </h2>
      {split && (growth.own.length > 0 || whole.length > 0) && (
        <h3 className="growth__track-title">{t("tracks.growth.whole")}</h3>
      )}
      <ul className="values__list">
        {growth.own.map((v) => (
          <li className="value" key={v}>
            <span className="value__number">{formatValue(lp, ctx, v, ev.values[v] ?? 0)}</span>
            <span className="value__name">{ptext(lp, `value.${v}.name`)}</span>
            <span className="value__from">{because}</span>
            {ptext(lp, `value.${v}.explain`) && (
              <span className="value__explain">
                <RichText lp={lp} text={ptext(lp, `value.${v}.explain`)} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {(split ? whole : growth.byThing).length > 0 && (
        <Groups groups={split ? whole : growth.byThing} because={because} />
      )}
      {split &&
        headTracks(ev).map((tr) => {
          const groups = growth.byThing.filter((g) => g.track === tr.thing);
          if (groups.length === 0) return null;
          return (
            <div className="growth__track" key={tr.thing}>
              <h3 className="growth__track-title">
                {t("tracks.growth.track", {
                  thing: thingName(lp, tr.thing),
                  levelName: ptext(lp, "level.name") ?? "",
                  level: tr.levels,
                })}
              </h3>
              <Groups
                groups={groups}
                because={t("tracks.growth.because", {
                  thing: thingName(lp, tr.thing),
                  levelName: word,
                  level: tr.levels,
                })}
              />
            </div>
          );
        })}
    </section>
  );
}

/** Values that things raise by level, each group under the thing that raises them. */
function Groups({
  groups,
  because,
}: {
  groups: { thing: string; values: string[] }[];
  because: string;
}): ReactNode {
  const { t } = useApp();
  const { lp, ev } = useDraft();
  const ctx = useMeasure(lp);
  return (
    <ul className="origins__list">
      {groups.map((g) => (
        <li className="origins__group" key={g.thing}>
          <p className="origins__from">
            {fillNodes((m) => t("growth.fromThing", { ...m, because }), {
              source: <ThingLabel lp={lp} id={g.thing} t={t} />,
            })}
          </p>
          <ul className="gift__numbers">
            {g.values.map((v) => (
              <li key={v}>
                {t("growth.number", {
                  name: ptext(lp, `value.${v}.name`) ?? v,
                  value: formatValue(lp, ctx, v, ev.values[v] ?? 0),
                })}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
