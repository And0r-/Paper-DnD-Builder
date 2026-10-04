"use client";
/**
 * The shared list of a gather step with `together: "list"` (SPEC 9.4): one
 * list for the picks of several sources. The player only taps; the rule
 * core decides which source each pick counts for. A counter per source
 * counts down, what the character already has is named on top, and an
 * option no free source offers stays in the list, greyed, with the reason.
 */
import type { ChoiceState, Evaluation, HeldThing, MeasureContext, PoolState, StepState } from "@builder/core";
import type { Thing } from "@builder/format/pure";
import { useMemo, useState } from "react";
import type { Translator } from "../../i18n/index.ts";
import { useApp } from "../app-state.tsx";
import { Callout } from "../components/Feedback.tsx";
import { TextField } from "../components/Fields.tsx";
import { useMeasure } from "../components/RichText.tsx";
import { plain, ptext, thingName } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import { groupOptions, OptionCard, SEARCH_FROM } from "./choices.tsx";
import { useDraft } from "./draft-state.tsx";
import { useGuardedChange } from "./guard.tsx";
import { stepTitle } from "./model.ts";

/**
 * Where the picks of a choice come from, for the counter: the package's
 * `choice.<id>.from` ("from your calling"), else the names of the things
 * that grant the choice ("Lantern bearer").
 */
export interface Source {
  /** The package text, used as "2 from your calling". */
  from?: string;
  /** Fallback, used as "Lantern bearer: 2". */
  name?: string;
}

export function sourceOf(lp: LoadedPackage, ctx: MeasureContext, state: ChoiceState | undefined): Source {
  if (!state) return {};
  const from = ptext(lp, `choice.${state.id}.from`);
  if (from) return { from: plain(ctx, from) };
  const names = (state.grantedBy ?? []).map((id) => thingName(lp, id)).filter(Boolean);
  return names.length > 0
    ? { name: new Intl.ListFormat(lp.lang, { type: "conjunction" }).format(names) }
    : {};
}

/** "2 from your calling" or "Lantern bearer: 2". */
function countOf(t: Translator["t"], n: number, s: Source): string {
  if (s.from) return t("pool.countFrom", { count: n, from: s.from });
  if (s.name) return t("pool.countName", { count: n, name: s.name });
  return String(n);
}

/** "from your calling" or "Lantern bearer": the source alone. */
function sourceText(s: Source): string {
  return s.from ?? s.name ?? "";
}

interface Row {
  choice: string;
  source: Source;
  count: number;
  remaining: number;
}

function rowsOf(lp: LoadedPackage, ctx: MeasureContext, ev: Evaluation, pool: PoolState): Row[] {
  return pool.choices.map((c) => ({
    choice: c.choice,
    source: sourceOf(lp, ctx, ev.choices[c.choice]),
    count: c.count,
    remaining: c.remaining,
  }));
}

/** The footer's reason on a list step: "1 more open: from your folk". */
export function poolMissingText(
  lp: LoadedPackage,
  ctx: MeasureContext,
  ev: Evaluation,
  pool: PoolState,
  t: Translator["t"],
  list: Translator["list"],
): string {
  const open = rowsOf(lp, ctx, ev, pool).filter((r) => r.remaining > 0);
  const remaining = open.reduce((n, r) => n + r.remaining, 0);
  const where =
    open.length === 1
      ? sourceText(open[0]!.source)
      : list(open.map((r) => countOf(t, r.remaining, r.source)));
  return where
    ? t("pool.missing", { remaining, where })
    : t("pick.missing", {
        remaining,
        picked: pool.count - remaining,
        count: pool.count,
      });
}

/** Things the character already has, grouped by where they came from. */
function heldGroups(
  lp: LoadedPackage,
  ev: Evaluation,
  held: HeldThing[],
  t: Translator["t"],
): { key: string; things: string[]; origin: string }[] {
  const groups = new Map<string, { key: string; things: string[]; origin: string }>();
  for (const h of held) {
    const key = h.grantedBy ? `g:${h.grantedBy}` : h.pickedIn ? `p:${h.pickedIn}` : `s:${h.step}`;
    let g = groups.get(key);
    if (!g) {
      const origin = h.grantedBy
        ? t("pool.heldBy", { name: thingName(lp, h.grantedBy) })
        : t("pool.heldPicked", { step: stepTitle(lp, ev, h.step) });
      g = { key, things: [], origin };
      groups.set(key, g);
    }
    g.things.push(thingName(lp, h.id));
  }
  return [...groups.values()];
}

export function PoolList({
  step,
  labelledBy,
}: {
  step: StepState & { pool: PoolState };
  labelledBy: string;
}) {
  const { t, list } = useApp();
  const { lp, ev } = useDraft();
  const ctx = useMeasure(lp);
  const guard = useGuardedChange();
  const [query, setQuery] = useState("");
  const [fullHint, setFullHint] = useState(false);
  const pool = step.pool;
  const states = pool.choices.map((c) => ev.choices[c.choice]).filter((s): s is ChoiceState => !!s);
  const options = useMemo(
    () => pool.options.map((id) => lp.pkg.things.find((th) => th.id === id)).filter((x): x is Thing => !!x),
    [pool.options, lp],
  );
  const rows = rowsOf(lp, ctx, ev, pool);
  // The sources' own recommendations; the list's full suggestion also holds fill-ins.
  const recommended = new Set(states.flatMap((s) => (Array.isArray(s.recommended) ? s.recommended : [])));
  const badges = Object.assign({}, ...states.map((s) => s.badges ?? {})) as Record<string, string>;
  const blocked = new Set(pool.blocked);
  const stepName = stepTitle(lp, ev, step.id);

  // Why an option is greyed: the only sources that offer it are full.
  const reason = (id: string): string | undefined => {
    if (!blocked.has(id) || pool.remaining === 0) return undefined;
    const by = rows.filter((r) => ev.choices[r.choice]?.options?.includes(id));
    const names = by.map((r) => sourceText(r.source)).filter(Boolean);
    return names.length > 0 ? t("pool.blockedFrom", { where: list(names) }) : t("pool.blocked");
  };

  const toggle = (id: string) => {
    const has = pool.picks.includes(id);
    if (!has && pool.remaining === 0) {
      setFullHint(true);
      return;
    }
    if (!has && blocked.has(id)) return;
    setFullHint(false);
    const picks = has ? pool.picks.filter((p) => p !== id) : [...pool.picks, id];
    guard.request({ type: "pool", step: step.id, picks }, () => ({
      title: t("change.title", { step: stepName }),
      lead: t("change.textGeneric"),
      after: t("change.afterGeneric"),
    }));
  };

  const shown = query.trim()
    ? options.filter((th) =>
        thingName(lp, th.id).toLocaleLowerCase(lp.lang).includes(query.trim().toLocaleLowerCase(lp.lang)),
      )
    : options;
  const held = heldGroups(lp, ev, pool.held, t);
  const open = rows.filter((r) => r.remaining > 0);
  const invalid = states.some((s) => s.status === "invalid");

  return (
    <fieldset className="options" aria-labelledby={labelledBy}>
      <p className="pool__total" data-pool-total>
        {t("pool.total", {
          count: pool.count,
          sources: list(rows.map((r) => countOf(t, r.count, r.source))),
        })}
      </p>
      {held.length > 0 && (
        <Callout tone="info" title={t("pool.held")}>
          <ul className="pool__held" data-pool-held>
            {held.map((g) => (
              <li key={g.key}>
                {list(g.things)} <span className="pool__origin">({g.origin})</span>
              </li>
            ))}
          </ul>
        </Callout>
      )}
      <div className="pick-counter" aria-live="polite" data-pool-counter>
        <p className="pick-counter__count">
          {open.length === 0
            ? t("pool.done", { count: pool.count })
            : t("pool.open", { sources: list(open.map((r) => countOf(t, r.remaining, r.source))) })}
        </p>
        {fullHint && <p className="pick-counter__hint">{t("pick.full", { count: pool.count })}</p>}
      </div>
      {invalid && (
        <Callout tone="warning" role="status">
          {t("flow.needsAttention")}
        </Callout>
      )}
      {options.length >= SEARCH_FROM && (
        <TextField
          label={t("pick.search")}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="options__search"
        />
      )}
      {options.length === 0 && <Callout tone="info">{t("pick.noOptions")}</Callout>}
      {options.length > 0 && shown.length === 0 && <p className="options__none">{t("pick.noResults")}</p>}
      {groupOptions(shown).map((g) => (
        <div className="options__group" key={g.group ?? "-"}>
          {g.group && <h2 className="options__group-title">{ptext(lp, `group.${g.group}.name`)}</h2>}
          <div className="options__list">
            {g.things.map((th) => (
              <OptionCard
                key={th.id}
                lp={lp}
                thing={th}
                type="checkbox"
                name={`pool-${step.id}`}
                checked={pool.picks.includes(th.id)}
                recommended={recommended.has(th.id)}
                badge={badges[th.id]}
                level={ev.level}
                blocked={reason(th.id)}
                onToggle={() => toggle(th.id)}
              />
            ))}
          </div>
        </div>
      ))}
      {guard.dialog}
    </fieldset>
  );
}
