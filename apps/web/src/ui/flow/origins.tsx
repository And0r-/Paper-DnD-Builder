"use client";
/**
 * "What you get without choosing": things on the sheet the player never
 * picked, each group with what brought it. Shown on the overview and at
 * the end, so nothing on the printout is a surprise.
 */
import { useId } from "react";
import { useApp } from "../app-state.tsx";
import { fillNodes, listNodes, ThingLabel, ThingName } from "../components/ThingName.tsx";
import { useDraft } from "./draft-state.tsx";
import { originGroups } from "./explain.ts";

export function Origins({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const { t, list } = useApp();
  const { lp, ev } = useDraft();
  const id = useId();
  const groups = originGroups(lp, ev, { t, list });
  if (groups.length === 0) return null;
  const Heading = `h${headingLevel}` as const;
  return (
    <section className="origins" aria-labelledby={id}>
      <Heading className="section-title" id={id}>
        {t("origins.title")}
      </Heading>
      <p className="origins__intro">{t("origins.intro")}</p>
      <ul className="origins__list">
        {groups.map((g) => (
          <li className="origins__group" key={g.from}>
            <p className="origins__from">
              {fillNodes((m) => t("origins.from", m), { source: <ThingLabel lp={lp} id={g.from} t={t} /> })}
            </p>
            <p className="origins__things">
              {listNodes(
                t,
                g.things.map((id) => <ThingName key={id} lp={lp} id={id} />),
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
