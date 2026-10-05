"use client";
/**
 * "What grows with your level": numbers that follow the level alone, each
 * with the reason ("6, because level 20"), and the numbers a thing raises
 * by level (places per rank), grouped under that thing. On the overview,
 * next to the main values, so a number on the sheet is never a riddle.
 */
import { useId } from "react";
import { useApp } from "../app-state.tsx";
import { RichText, useMeasure } from "../components/RichText.tsx";
import { formatValue, levelWord, ptext } from "../package-text.ts";
import { useDraft } from "./draft-state.tsx";
import { levelGrowth, thingLabel } from "./explain.ts";

export function LevelGrowth() {
  const { t, list } = useApp();
  const { lp, ev } = useDraft();
  const ctx = useMeasure(lp);
  const id = useId();
  const growth = levelGrowth(lp, ev);
  if (growth.own.length === 0 && growth.byThing.length === 0) return null;
  const word = levelWord(lp);
  const because = t("growth.because", { levelName: word, level: ev.level });
  return (
    <section className="growth" aria-labelledby={id}>
      <h2 className="section-title" id={id}>
        {t("growth.title", { levelName: word })}
      </h2>
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
      {growth.byThing.length > 0 && (
        <ul className="origins__list">
          {growth.byThing.map((g) => (
            <li className="origins__group" key={g.thing}>
              <p className="origins__from">
                {t("growth.fromThing", { source: thingLabel(lp, g.thing, { t, list }), because })}
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
      )}
    </section>
  );
}
