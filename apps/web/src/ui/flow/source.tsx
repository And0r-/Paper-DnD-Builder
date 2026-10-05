"use client";
/**
 * Where a choice comes from, when an earlier choice brought it along
 * (AND-90): "Where this comes from: Feat Spark Pupil from Upbringing Bell
 * Tower". Without it a player who picked another thing of the same kind
 * does not know which one the question is about. A share-out that offers
 * only some of the values says who decided that: "Upbringing Bell Tower
 * allows Might, Wit and Heart."
 */
import type { ChoiceState, Evaluation } from "@builder/core";
import type { Choice } from "@builder/format/pure";
import type { ReactNode } from "react";
import { useApp } from "../app-state.tsx";
import { fillNodes, listNodes, ThingLabel } from "../components/ThingName.tsx";
import { thingName } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import { useDraft } from "./draft-state.tsx";
import { rowName, rowValues } from "./explain.ts";

/**
 * The thing that brought the choice, and the thing the player picked that
 * brought that one in turn (gifts of gifts are followed to the start).
 * One entry when the player picked the bringer itself.
 */
export function sourceChain(lp: LoadedPackage, ev: Evaluation, state: ChoiceState): string[] {
  const by = state.grantedBy?.find((id) => thingName(lp, id));
  if (!by) return [];
  const held = new Map(ev.things.map((h) => [h.id, h]));
  let root = by;
  const seen = new Set<string>();
  while (held.get(root)?.grantedBy !== undefined && !seen.has(root)) {
    seen.add(root);
    root = held.get(root)!.grantedBy!;
  }
  return root !== by && thingName(lp, root) ? [by, root] : [by];
}

/**
 * Whether a share-out offers only some of the values one can share out
 * to: fewer than the widest share-out of the package. Only then is "allows
 * Might, Wit and Heart" worth saying.
 */
function offersFewer(lp: LoadedPackage, targets: readonly string[]): boolean {
  const totals = (ts: readonly string[]) => new Set(ts.map((v) => rowValues(lp, v).total)).size;
  const widest = Math.max(
    ...lp.pkg.flow.choices.map((c) => (c.kind === "distribute" ? totals(c.targets) : 0)),
  );
  return totals(targets) < widest;
}

export function ChoiceSource({ def, state }: { def: Choice; state: ChoiceState }) {
  const { t } = useApp();
  const { lp, ev } = useDraft();
  if (def.kind === "info") return null;
  const chain = sourceChain(lp, ev, state);
  if (chain.length === 0) return null;
  const [by, root] = chain as [string, string | undefined];
  const source: ReactNode = (
    <>
      <ThingLabel lp={lp} id={by} t={t} />
      {root && (
        <> {fillNodes((m) => t("explain.from", m), { source: <ThingLabel lp={lp} id={root} t={t} /> })}</>
      )}
    </>
  );
  const text =
    def.kind === "distribute" && offersFewer(lp, def.targets)
      ? fillNodes((m) => t("flow.sourceAllows", m), {
          source,
          targets: listNodes(
            t,
            def.targets.map((v) => rowName(lp, v)),
          ),
        })
      : fillNodes((m) => t("flow.source", m), { source });
  return (
    <p className="choice-source" data-choice-source>
      {text}
    </p>
  );
}
