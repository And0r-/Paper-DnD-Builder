"use client";
/**
 * Names of things where their description is not on screen (overview,
 * level section, end): the name stays, its first sentence shows on hover
 * and tap (AND-87).
 */
import { Fragment, type ReactNode } from "react";
import type { Translator } from "../../i18n/index.ts";
import { ptext, thingHint, thingName } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import { Term } from "./Explained.tsx";
import { useMeasure } from "./RichText.tsx";

export function ThingName({ lp, id }: { lp: LoadedPackage; id: string }) {
  const ctx = useMeasure(lp);
  return <Term hint={thingHint(lp, ctx, id)}>{thingName(lp, id)}</Term>;
}

/** "Calling Lantern Bearer": the kind as a word, the name explaining itself. */
export function ThingLabel({ lp, id, t }: { lp: LoadedPackage; id: string; t: Translator["t"] }) {
  const kind = lp.pkg.things.find((x) => x.id === id)?.kind;
  const kindName = kind ? ptext(lp, `kind.${kind}.name`) : undefined;
  const name = <ThingName lp={lp} id={id} />;
  return kindName ? <>{fillNodes((m) => t("explain.thing", { kind: kindName, ...m }), { name })}</> : name;
}

/** Fills a message whose placeholders are nodes ("{things}" → names that explain themselves). */
export function fillNodes(text: (marks: Record<string, string>) => string, nodes: Record<string, ReactNode>) {
  const marks = Object.fromEntries(Object.keys(nodes).map((k) => [k, `\uE000${k}\uE000`]));
  return text(marks)
    .split(/\uE000(\w+)\uE000/)
    .map((part, i) => <Fragment key={i}>{i % 2 === 1 ? nodes[part] : part}</Fragment>);
}

/** "A, B and C" with nodes, in the words of `Translator.list`. */
export function listNodes(t: Translator["t"], items: readonly ReactNode[]): ReactNode {
  if (items.length <= 1) return items[0] ?? null;
  const head = items.slice(0, -1).flatMap((n, i) => (i === 0 ? [n] : [", ", n]));
  return fillNodes((m) => t("flow.and", m), {
    a: head.map((n, i) => <Fragment key={i}>{n}</Fragment>),
    b: items.at(-1),
  });
}
