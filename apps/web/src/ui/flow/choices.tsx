"use client";
/**
 * The six kinds of questions (flow spec 3): pickOne, pickMany, distribute,
 * number, text, info. Every option explains itself where it is chosen.
 */
import { evaluationScope, explainValue, filledTextKey, formatMeasure, type ChoiceState } from "@builder/core";
import type { Choice, Thing } from "@builder/format/pure";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "../app-state.tsx";
import { Button } from "../components/Button.tsx";
import { Callout } from "../components/Feedback.tsx";
import { Disclosure, Segmented, TextField } from "../components/Fields.tsx";
import { Icon } from "../components/Icon.tsx";
import { RichText, useMeasure } from "../components/RichText.tsx";
import {
  choiceTargetText,
  choiceTexts,
  distributeMethodLabels,
  formatValue,
  grantedValue,
  isYesNoValue,
  levelWord,
  plain,
  plist,
  ptext,
  thingName,
} from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import { fillNodes, ThingName } from "../components/ThingName.tsx";
import { useDraft } from "./draft-state.tsx";
import { laterSteps, rowEffect, rowIsBase, rowName, rowSum, rowValues, sumText } from "./explain.ts";
import { fillArray, forcedArray, freeMarks } from "./array-fill.ts";
import { useExplain } from "./frame.tsx";
import { useGuardedChange } from "./guard.tsx";
import { longListGroups, SEARCH_FROM } from "./long-list.ts";
import { stepHref, stepTitle } from "./model.ts";

// ------------------------------------------------------------ explanation

function Stats({ lp, thing }: { lp: LoadedPackage; thing: Thing }) {
  const { t } = useApp();
  const { ev } = useDraft();
  const ctx = useMeasure(lp);
  const entries = Object.entries(thing.stats ?? {});
  if (entries.length === 0) return null;
  const scope = evaluationScope(lp.pkg, ev);
  return (
    <dl className="stats">
      {entries.map(([key, v]) => {
        let shown: string;
        if (typeof v === "number") shown = new Intl.NumberFormat(lp.lang).format(v);
        else if (typeof v === "boolean") shown = v ? t("common.yes") : t("common.no");
        else if ("amount" in v) shown = formatMeasure(ctx, v, "long");
        // A stat that names a value shows the character's value (uses that grow with the level).
        else if ("value" in v)
          shown = formatValue(lp, ctx, v.value, v.value === "level" ? ev.level : (ev.values[v.value] ?? 0));
        // `vars` fill the text with the character's values ("1d8 +3"); a variant may replace the text.
        else
          shown = plain(
            ctx,
            ptext(lp, filledTextKey(v, scope)),
            Object.fromEntries(Object.entries(v.vars ?? {}).map(([n, id]) => [n, ev.values[id] ?? 0])),
          );
        return (
          <div className="stats__row" key={key}>
            <dt>{ptext(lp, `stat.${key}.name`)}</dt>
            <dd>{shown}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function Grants({ lp, thing, level }: { lp: LoadedPackage; thing: Thing; level: number }) {
  const { t } = useApp();
  const { ev } = useDraft();
  const ctx = useMeasure(lp);
  const items: ReactNode[] = [];
  // Changes of one value over several levels count as one line ("Stamina +15").
  const adds = new Map<string, number>();
  for (const g of thing.grants ?? []) {
    if ((g.atLevel ?? 1) <= level && g.value && typeof g.add === "number") {
      adds.set(g.value, (adds.get(g.value) ?? 0) + g.add);
    }
  }
  for (const [value, add] of adds) {
    items.push(<li key={`v-${value}`}>{grantedValue(lp, ctx, value, add, ev.values[value])}</li>);
  }
  for (const [i, g] of (thing.grants ?? []).entries()) {
    if ((g.atLevel ?? 1) > level) continue;
    if (g.thing)
      items.push(
        <li key={i}>
          {(g.count ?? 1) > 1
            ? t("option.count", { count: g.count!, name: thingName(lp, g.thing) })
            : thingName(lp, g.thing)}
        </li>,
      );
    else if (g.choice)
      items.push(
        <li key={i}>
          {t("option.youChoose", { title: choiceTexts(lp, g.choice, ev.choices[g.choice], ctx).title })}
        </li>,
      );
  }
  if (items.length === 0) return null;
  return (
    <div className="grants">
      <p className="grants__title">{t("option.youGet")}</p>
      <ul className="grants__list">{items}</ul>
    </div>
  );
}

/** Long explanation of one option: what it is, what it means at the table, an example, facts, gifts, rules text. */
export function OptionDetails({ lp, thing, level }: { lp: LoadedPackage; thing: Thing; level: number }) {
  const { t } = useApp();
  const [rules, setRules] = useState(false);
  const rulesText = ptext(lp, `${thing.id}.rules`);
  const example = ptext(lp, `${thing.id}.explain.example`);
  return (
    <div className="details">
      <p>
        <RichText lp={lp} text={ptext(lp, `${thing.id}.explain.what`)} />
      </p>
      <p>
        <RichText lp={lp} text={ptext(lp, `${thing.id}.explain.table`)} />
      </p>
      {example && (
        <p className="details__example">
          <RichText lp={lp} text={example} />
        </p>
      )}
      <Stats lp={lp} thing={thing} />
      <Grants lp={lp} thing={thing} level={level} />
      {rulesText && (
        <div className="rules">
          <button
            type="button"
            className="link-button"
            aria-expanded={rules}
            onClick={(e) => {
              e.stopPropagation();
              setRules((r) => !r);
            }}
          >
            {rules ? t("option.rulesHide") : t("option.rulesShow")}
          </button>
          {rules && (
            <div className="rules__text">
              <p className="rules__title">{t("option.rulesTitle")}</p>
              <p>{rulesText}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- options

/**
 * A card picked while part of it is under the Back / Next bar (or the top
 * bar) comes fully into view, so the player sees what they chose. The page's
 * scroll padding keeps it clear of both bars; a card taller than the room
 * between them shows from its top.
 */
function bringIntoView(card: HTMLElement) {
  const html = document.documentElement;
  const style = getComputedStyle(html);
  const top = parseFloat(style.scrollPaddingTop) || 0;
  const bottom = parseFloat(style.scrollPaddingBottom) || 0;
  const r = card.getBoundingClientRect();
  if (r.top >= top && r.bottom <= window.innerHeight - bottom) return;
  const fits = r.height <= window.innerHeight - top - bottom;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ block: fits ? "nearest" : "start", behavior: still ? "auto" : "smooth" });
}

/** True when a point lies on the Back / Next bar, which lets taps through to the cards under it. */
function underFooter(x: number, y: number): boolean {
  const footer = document.querySelector(".step-footer__dock");
  const bar = footer && getComputedStyle(footer).position !== "fixed" ? footer.parentElement : footer;
  const r = bar?.getBoundingClientRect();
  return r !== undefined && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

export function OptionCard({
  lp,
  thing,
  type,
  name,
  checked,
  recommended,
  badge,
  level,
  blocked,
  onToggle,
}: {
  lp: LoadedPackage;
  thing: Thing;
  type: "radio" | "checkbox";
  name: string;
  checked: boolean;
  recommended: boolean;
  /** Package text key of this option's badge; shown instead of "recommended". */
  badge: string | undefined;
  level: number;
  /** Why this option cannot be picked right now; it stays readable and focusable. */
  blocked?: string | undefined;
  onToggle: () => void;
}) {
  const { t } = useApp();
  const explain = useExplain();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const goodIf = ptext(lp, `${thing.id}.goodIf`);
  const badgeText = badge ? ptext(lp, badge) : undefined;
  const details = <OptionDetails lp={lp} thing={thing} level={level} />;
  const showExplain = () =>
    explain(
      <>
        <p className="explain-panel__title">{thingName(lp, thing.id)}</p>
        {details}
      </>,
    );
  return (
    <div
      ref={card}
      className={`option${checked ? " option--checked" : ""}${blocked ? " option--blocked" : ""}`}
      onClick={(e) => {
        // The whole card picks the option, except its own buttons and links.
        if ((e.target as HTMLElement).closest("button, a, input, label, select, textarea")) return;
        input.current?.click();
      }}
      onFocus={showExplain}
      onMouseEnter={(e) => {
        // A pointer on the Back / Next bar is not on the card under it.
        if (!underFooter(e.clientX, e.clientY)) showExplain();
      }}
      data-option={thing.id}
    >
      <div className="option__head">
        <input
          ref={input}
          className="option__input"
          type={type}
          id={id}
          name={name}
          value={thing.id}
          checked={checked}
          onChange={() => {
            if (blocked) return;
            onToggle();
            if (!checked && card.current) bringIntoView(card.current);
          }}
          aria-disabled={blocked ? true : undefined}
          aria-describedby={blocked ? `${id}-blocked ${id}-short` : `${id}-short`}
        />
        <span className="option__mark" aria-hidden="true">
          {checked && <Icon name={type === "radio" ? "dot" : "check"} size={type === "radio" ? 14 : 18} />}
        </span>
        <label className="option__name" htmlFor={id}>
          {thingName(lp, thing.id)}
        </label>
        {badgeText ? (
          <span className="badge badge--neutral">{badgeText}</span>
        ) : (
          recommended && <span className="badge">{t("common.recommended")}</span>
        )}
      </div>
      {blocked && (
        <p className="option__blocked" id={`${id}-blocked`}>
          <Icon name="info" size={18} />
          <span>{blocked}</span>
        </p>
      )}
      <p className="option__short" id={`${id}-short`}>
        <RichText lp={lp} text={ptext(lp, `${thing.id}.short`)} />
      </p>
      {goodIf && (
        <p className="option__goodif">
          <RichText lp={lp} text={goodIf} />
        </p>
      )}
      <Disclosure className="option__more" more={t("common.moreInfo")} less={t("common.lessInfo")}>
        {details}
      </Disclosure>
    </div>
  );
}

export function PickChoice({
  choice,
  state,
  labelledBy,
}: {
  choice: Extract<Choice, { kind: "pickOne" | "pickMany" }>;
  state: ChoiceState;
  labelledBy: string;
}) {
  const { t } = useApp();
  const { lp, ev } = useDraft();
  const guard = useGuardedChange();
  const [query, setQuery] = useState("");
  const [fullHint, setFullHint] = useState(false);
  const single = choice.kind === "pickOne";
  const options = useMemo(
    () =>
      (state.options ?? [])
        .map((id) => lp.pkg.things.find((th) => th.id === id))
        .filter((x): x is Thing => !!x),
    [state.options, lp],
  );
  const offered = new Set(state.options ?? []);
  const answer = state.answer as { pick?: string; picks?: string[] } | undefined;
  const picked = single
    ? answer?.pick && offered.has(answer.pick)
      ? [answer.pick]
      : []
    : (answer?.picks ?? []).filter((p) => offered.has(p));
  const count = state.count ?? 1;
  const recommended = Array.isArray(state.recommended) ? state.recommended : [];
  const stepName = stepTitle(lp, ev, state.step);

  const shown = query.trim()
    ? options.filter((th) =>
        thingName(lp, th.id).toLocaleLowerCase(lp.lang).includes(query.trim().toLocaleLowerCase(lp.lang)),
      )
    : options;

  const toggle = (id: string) => {
    if (single) {
      const old = answer?.pick && answer.pick !== id ? answer.pick : undefined;
      guard.request({ type: "answer", choice: choice.id, answer: { pick: id } }, () => ({
        title: t("change.title", { step: stepName }),
        lead: old
          ? t("change.textPick", { new: thingName(lp, id), old: thingName(lp, old) })
          : t("change.textGeneric"),
        after: old ? t("change.after", { old: thingName(lp, old) }) : t("change.afterGeneric"),
      }));
      return;
    }
    const has = picked.includes(id);
    if (!has && picked.length >= count) {
      setFullHint(true);
      return;
    }
    setFullHint(false);
    const picks = has ? picked.filter((p) => p !== id) : [...picked, id];
    guard.request({ type: "answer", choice: choice.id, answer: picks.length > 0 ? { picks } : null }, () => ({
      title: t("change.title", { step: stepName }),
      lead: t("change.textGeneric"),
      after: t("change.afterGeneric"),
    }));
  };

  if (options.length === 0) {
    return <Callout tone="info">{t("pick.noOptions")}</Callout>;
  }

  const name = `choice-${choice.id}`;
  return (
    <fieldset className="options" aria-labelledby={labelledBy}>
      {!single && (
        <div className="pick-counter" aria-live="polite">
          <p className="pick-counter__count">
            {t(state.upTo ? "pick.counterUpTo" : "pick.counter", { picked: picked.length, count })}
          </p>
          {fullHint && <p className="pick-counter__hint">{t("pick.full", { count })}</p>}
        </div>
      )}
      {state.status === "invalid" && (
        <Callout tone="warning" role="status">
          {state.givenBy
            ? Object.entries(state.givenBy).map(([thing, by]) => (
                <p key={thing} data-given-by={thing}>
                  {fillNodes((m) => t("flow.givenElsewhere", m), {
                    thing: <ThingName lp={lp} id={thing} />,
                    by: <ThingName lp={lp} id={by} />,
                  })}
                </p>
              ))
            : t("flow.needsAttention")}
        </Callout>
      )}
      {choice.held && state.held && state.held.length > 0 && (
        <Callout tone="info">
          <p data-held>
            <RichText
              lp={lp}
              text={ptext(lp, choice.held.text)}
              vars={{
                things: new Intl.ListFormat(lp.lang, { type: "conjunction" }).format(
                  state.held.map((id) => thingName(lp, id)),
                ),
              }}
            />
          </p>
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
      {shown.length === 0 && <p className="options__none">{t("pick.noResults")}</p>}
      {longListGroups(
        lp,
        shown,
        options.length >= SEARCH_FROM,
        query.trim() ? [] : recommended,
        t("pick.recommendedGroup"),
      ).map((g) => (
        <div className="options__group" key={g.group ?? "-"}>
          {g.title && <h2 className="options__group-title">{g.title}</h2>}
          <div className="options__list">
            {g.things.map((th) => (
              <OptionCard
                key={th.id}
                lp={lp}
                thing={th}
                type={single ? "radio" : "checkbox"}
                name={name}
                checked={picked.includes(th.id)}
                recommended={recommended.includes(th.id)}
                badge={state.badges?.[th.id]}
                level={ev.level}
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

// ------------------------------------------------------------- distribute

export function DistributeChoice({
  choice,
  state,
  labelledBy,
  onMethod,
}: {
  choice: Extract<Choice, { kind: "distribute" }>;
  state: ChoiceState;
  labelledBy: string;
  /** Told which way is shown, so the step can say what is missing in its words. */
  onMethod?: (method: number) => void;
}) {
  const { t, tc, list } = useApp();
  const { lp, ev } = useDraft();
  const guard = useGuardedChange();
  const stored = state.answer as { method: number; assign: Record<string, number> } | undefined;
  const [method, setMethod] = useState<number>(stored?.method ?? 0);
  const m = choice.methods[method]!;
  useEffect(() => onMethod?.(method), [method, onMethod]);
  const stepName = stepTitle(lp, ev, state.step);

  // The rows keep their own numbers while you type. An answer that comes
  // from elsewhere ("Choose for me", a refused change) starts them afresh,
  // so the screen always shows what is saved.
  const sign = (a: { method: number; assign: Record<string, number> }) =>
    JSON.stringify([a.method, ...choice.targets.map((v) => a.assign[v] ?? null)]);
  const mine = useRef(stored ? sign(stored) : undefined);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!stored || sign(stored) === mine.current) return;
    mine.current = sign(stored);
    setMethod(stored.method);
    setRound((r) => r + 1);
  }, [stored]);

  const words = () => ({
    title: t("change.title", { step: stepName }),
    lead: t("change.textGeneric"),
    after: t("change.afterGeneric"),
  });
  const saveAs = (way: number, assign: Record<string, number>) => {
    mine.current = sign({ method: way, assign });
    return guard.request({ type: "answer", choice: choice.id, answer: { method: way, assign } }, words);
  };
  const save = (assign: Record<string, number>) => saveAs(method, assign);
  // An answer the screen no longer shows is taken back, so the step never
  // looks open while an old answer still counts.
  const clear = () => {
    mine.current = undefined;
    return guard.request({ type: "answer", choice: choice.id, answer: null }, words);
  };
  const changeMethod = (way: number) => {
    setMethod(way);
    const m2 = choice.methods[way]!;
    const forced = m2.method === "array" ? forcedArray(choice.targets, m2.values) : undefined;
    if (forced) saveAs(way, forced);
    else if (stored && stored.method !== way) clear();
  };
  const rec = state.recommended && !Array.isArray(state.recommended) ? state.recommended : undefined;

  return (
    <fieldset className="distribute" aria-labelledby={labelledBy}>
      {choice.methods.length > 1 && (
        <Segmented
          legend={t("dist.method")}
          options={distributeMethodLabels(choice.methods, lp.lang, t, list).map((label, i) => ({
            value: i,
            label,
          }))}
          value={method}
          onChange={changeMethod}
        />
      )}
      {m.method === "raise" ? (
        <RaisePoints
          key={`ra-${round}`}
          lp={lp}
          targets={choice.targets}
          raise={state.raise ?? { points: m.points, before: {}, most: {} }}
          initial={stored?.method === method ? stored.assign : undefined}
          tip={rec?.method === method ? rec.assign : undefined}
          onSave={save}
          tc={tc}
        />
      ) : m.method === "pointBuy" ? (
        <PointBuy
          key={`pb-${method}-${round}`}
          lp={lp}
          state={state}
          targets={choice.targets}
          costs={m.costs}
          budget={m.budget}
          initial={stored?.method === method ? stored.assign : undefined}
          onSave={save}
          tc={tc}
        />
      ) : (
        <ArrayAssign
          key={`ar-${method}-${round}`}
          lp={lp}
          state={state}
          targets={choice.targets}
          values={m.values}
          initial={stored?.method === method ? stored.assign : undefined}
          tip={rec?.method === method ? rec.assign : undefined}
          onSave={save}
          onClear={clear}
        />
      )}
      {guard.dialog}
    </fieldset>
  );
}

/**
 * The point rule in one sentence, from the costs: "Each + costs 1 point,
 * from 14 on it costs 2 points."
 */
function pointRule(costs: Record<string, number>, t: ReturnType<typeof useApp>["tc"]): string {
  const scores = Object.keys(costs)
    .map(Number)
    .sort((a, b) => a - b);
  const steps: { from: number; cost: number }[] = [];
  for (let i = 1; i < scores.length; i++) {
    const cost = costs[String(scores[i])]! - costs[String(scores[i - 1])]!;
    if (steps.at(-1)?.cost !== cost) steps.push({ from: scores[i]!, cost });
  }
  const [first, ...rest] = steps;
  if (!first) return "";
  return (
    [t("dist.rule", first.cost), ...rest.map((s) => t("dist.ruleFrom", s.cost, { score: s.from }))].join(
      ", ",
    ) + "."
  );
}

/**
 * Points spent on values. Each row says what its number does for this
 * character: the score with what else adds to it, the number the sheet
 * prints next to it (a bonus), and a sentence from the package; rows that
 * matter most for the character carry the package's badge. The rule and the
 * points left stand above the rows.
 */
function PointBuy({
  lp,
  state,
  targets,
  costs,
  budget,
  initial,
  onSave,
  tc,
}: {
  lp: LoadedPackage;
  state: ChoiceState;
  targets: string[];
  costs: Record<string, number>;
  budget: number;
  initial: Record<string, number> | undefined;
  onSave: (assign: Record<string, number>) => void;
  tc: ReturnType<typeof useApp>["tc"];
}) {
  const { t, list } = useApp();
  const { ev } = useDraft();
  const ctx = useMeasure(lp);
  const scores = Object.keys(costs)
    .map(Number)
    .sort((a, b) => a - b);
  const low = scores[0]!;
  const high = scores.at(-1)!;
  const [assign, setAssign] = useState<Record<string, number>>(
    () => initial ?? Object.fromEntries(targets.map((v) => [v, low])),
  );
  const [hint, setHint] = useState<string | null>(null);
  const spent = targets.reduce((sum, v) => sum + (costs[String(assign[v])] ?? 0), 0);
  const left = budget - spent;

  const set = (v: string, score: number) => {
    const next = { ...assign, [v]: score };
    const cost = targets.reduce((sum, x) => sum + (costs[String(next[x])] ?? 0), 0);
    if (cost > budget) {
      setHint(t("dist.notEnough"));
      return;
    }
    setHint(null);
    setAssign(next);
    onSave(next);
  };

  return (
    <div className="pointbuy">
      <p className={left === 0 ? "pointbuy__left pointbuy__left--done" : "pointbuy__left"} aria-live="polite">
        {left === 0 ? (
          <>
            <Icon name="check" size={20} />
            {t("dist.allSpent")}
          </>
        ) : (
          <>
            <span className="pointbuy__count">{left}</span> {tc("dist.leftUnit", left)}
          </>
        )}
      </p>
      <p className="pointbuy__rule">{pointRule(costs, tc)}</p>
      {hint && (
        <p className="pointbuy__hint" role="status">
          {hint}
        </p>
      )}
      <ul className="pointbuy__rows">
        {targets.map((v) => {
          const score = assign[v] ?? low;
          const name = rowName(lp, v);
          const sum = rowSum(lp, ctx, ev, state.id, v, score, { t, list });
          const effect = rowEffect(lp, ctx, ev, state.id, v, score, { t, list });
          const badge = state.badges?.[v];
          const explain = choiceTargetText(lp, state.id, v, rowValues(lp, v).total, state);
          // Too expensive is shown before the tap; tapping anyway explains why (the hint).
          const affordable = (costs[String(score + 1)] ?? Infinity) - (costs[String(score)] ?? 0) <= left;
          return (
            <li className={badge ? "pointbuy__row pointbuy__row--key" : "pointbuy__row"} key={v}>
              <div className="pointbuy__label">
                <span className="pointbuy__name">
                  <span id={`pb-${v}`}>{name}</span>
                  {badge && <span className="badge">{ptext(lp, badge)}</span>}
                </span>
              </div>
              <div className="stepper">
                <button
                  type="button"
                  className="stepper__btn"
                  aria-label={t("dist.decrease", { name })}
                  aria-disabled={score <= low || undefined}
                  onClick={() => score > low && set(v, score - 1)}
                >
                  <Icon name="minus" />
                </button>
                <output
                  className="stepper__value"
                  aria-labelledby={`pb-${v}`}
                  aria-describedby={sum || effect ? `pb-${v}-effect` : undefined}
                  aria-live="polite"
                >
                  {score}
                </output>
                <button
                  type="button"
                  className="stepper__btn"
                  aria-label={t("dist.increase", { name })}
                  aria-disabled={score >= high || !affordable || undefined}
                  onClick={() => score < high && set(v, score + 1)}
                >
                  <Icon name="plus" />
                </button>
              </div>
              {(sum || effect) && (
                <span className="pointbuy__gives" id={`pb-${v}-effect`}>
                  {sum && <span className="pointbuy__sum">{sum}</span>}
                  {effect && <span className="pointbuy__effect">{effect}</span>}
                </span>
              )}
              {explain && (
                <span className="pointbuy__explain">
                  <RichText lp={lp} text={explain} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Points added on top of the values the character already has (a boon on a
 * higher level). Each row reads as a sum: the value now, the points added
 * (between − and +) and the value after. A row that cannot take more says
 * why ("already 15"), so a grey + never stands without a reason.
 */
function RaisePoints({
  lp,
  targets,
  raise,
  initial,
  tip,
  onSave,
  tc,
}: {
  lp: LoadedPackage;
  targets: string[];
  raise: NonNullable<ChoiceState["raise"]>;
  initial: Record<string, number> | undefined;
  /** The package's recommendation, shown as a tip per row. */
  tip: Record<string, number> | undefined;
  onSave: (assign: Record<string, number>) => void;
  tc: ReturnType<typeof useApp>["tc"];
}) {
  const { t } = useApp();
  const [assign, setAssign] = useState<Record<string, number>>(() => initial ?? {});
  const spent = targets.reduce((sum, v) => sum + (assign[v] ?? 0), 0);
  const left = raise.points - spent;
  const room = (v: string) => (raise.most[v] ?? 0) - (assign[v] ?? 0);
  const stuck = left > 0 && targets.every((v) => room(v) <= 0);

  const set = (v: string, added: number) => {
    const next = { ...assign, [v]: added };
    if (added === 0) delete next[v];
    setAssign(next);
    onSave(next);
  };

  return (
    <div className="pointbuy raise">
      <p className={left === 0 ? "pointbuy__left pointbuy__left--done" : "pointbuy__left"} aria-live="polite">
        {left === 0 && <Icon name="check" size={20} />}
        {left === 0 ? t("dist.allSpent") : stuck ? t("dist.noRoom") : tc("dist.left", left)}
      </p>
      <ul className="pointbuy__rows">
        {targets.map((v) => {
          const added = assign[v] ?? 0;
          const before = raise.before[v] ?? 0;
          const most = raise.most[v] ?? 0;
          const name = ptext(lp, `value.${v}.name`) ?? v;
          // Why + is grey: the value is at its limit already, or this row took all it may.
          const why =
            most <= 0
              ? t("dist.raiseFull", { value: String(before) })
              : room(v) <= 0 && left > 0
                ? t("dist.raiseMost", { value: String(before + most) })
                : undefined;
          const tipped = tip?.[v];
          return (
            <li className={`pointbuy__row${most <= 0 ? " pointbuy__row--full" : ""}`} key={v}>
              <div className="pointbuy__label">
                <span className="pointbuy__name" id={`ra-${v}`}>
                  {name}
                  {tipped !== undefined && tipped > 0 && (
                    <span className="badge">{t("dist.tip", { value: `+${tipped}` })}</span>
                  )}
                </span>
                <span className="raise__sum" id={`ra-${v}-sum`}>
                  {t("dist.raiseValue", {
                    before: String(before),
                    added: String(added),
                    value: String(before + added),
                  })}
                </span>
                {why && (
                  <span className="raise__why" id={`ra-${v}-why`}>
                    {why}
                  </span>
                )}
              </div>
              <div className="stepper">
                <button
                  type="button"
                  className="stepper__btn"
                  aria-label={t("dist.decrease", { name })}
                  aria-disabled={added <= 0 || undefined}
                  onClick={() => added > 0 && set(v, added - 1)}
                >
                  <Icon name="minus" />
                </button>
                <output className="stepper__value" aria-labelledby={`ra-${v} ra-${v}-sum`} aria-live="polite">
                  +{added}
                </output>
                <button
                  type="button"
                  className="stepper__btn"
                  aria-label={t("dist.increase", { name })}
                  aria-describedby={why ? `ra-${v}-why` : undefined}
                  aria-disabled={left <= 0 || room(v) <= 0 || undefined}
                  onClick={() => left > 0 && room(v) > 0 && set(v, added + 1)}
                >
                  <Icon name="plus" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Fixed numbers, given out by tapping (no dropdowns). A tap on an open row
 * gives it the highest number still free; a tap on a row with a number
 * takes it back. Once only the lowest number is left, the open rows get it
 * by themselves, so a row of equal numbers needs no tap at all.
 */
function ArrayAssign({
  lp,
  state,
  targets,
  values,
  initial,
  tip,
  onSave,
  onClear,
}: {
  lp: LoadedPackage;
  state: ChoiceState;
  targets: string[];
  values: number[];
  initial: Record<string, number> | undefined;
  /** The package's suggestion for this row of numbers, shown on each row while open. */
  tip: Record<string, number> | undefined;
  onSave: (assign: Record<string, number>) => void;
  onClear: () => void;
}) {
  const { t, list } = useApp();
  const { ev } = useDraft();
  const ctx = useMeasure(lp);
  const lowest = Math.min(...values);
  // Only the numbers given by a tap are kept; the lowest number fills the rest.
  const [taps, setTaps] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.entries(initial ?? {}).filter(([, n]) => n !== lowest)),
  );
  const { assign, free, implicit } = fillArray(targets, values, taps);
  const complete = targets.every((v) => assign[v] !== undefined);
  const next = free[0];

  const tap = (v: string) => {
    const nextTaps = { ...taps };
    if (taps[v] !== undefined) delete nextTaps[v];
    else if (next !== undefined) nextTaps[v] = next;
    else return;
    setTaps(nextTaps);
    const filled = fillArray(targets, values, nextTaps);
    if (targets.every((x) => filled.assign[x] !== undefined)) onSave(filled.assign as Record<string, number>);
    else if (complete) onClear();
  };

  const allSame = Object.keys(taps).length === 0 && complete;
  const status = allSame
    ? t("dist.allSame", { value: String(lowest) })
    : complete
      ? t("dist.tapDone")
      : t("dist.tapNext", { value: String(next) });

  return (
    <div className="array-assign">
      {!allSame && (
        <p className="array-assign__tray">
          <span className="array-assign__tray-label">{t("dist.toGive")}</span>
          {freeMarks(values, free).map(({ n, used }, i) => {
            return (
              <span key={i} className={used ? "chip chip--used" : "chip"}>
                {n}
                {used && <span className="visually-hidden"> ({t("dist.used")})</span>}
              </span>
            );
          })}
        </p>
      )}
      <p
        className={complete ? "array-assign__status array-assign__status--done" : "array-assign__status"}
        aria-live="polite"
      >
        {complete && <Icon name="check" size={20} />}
        {status}
      </p>
      <ul className="array-assign__rows">
        {targets.map((v) => {
          const name = rowName(lp, v);
          const explain = choiceTargetText(lp, state.id, v, rowValues(lp, v).total, state);
          const value = assign[v];
          // The row as a sum while numbers are handed out: "15 + 2 = 17", and what the score gives.
          // A bonus not given yet reads "+ 0"; a base without its number shows no sum.
          const amount = value ?? (rowIsBase(lp, v) ? undefined : 0);
          const sum =
            amount === undefined ? undefined : rowSum(lp, ctx, ev, state.id, v, amount, { t, list });
          const effect = rowEffect(lp, ctx, ev, state.id, v, amount, { t, list });
          const badge = state.badges?.[v];
          const fixed = implicit.includes(v);
          const suggested = !complete && tip?.[v] !== undefined && tip[v] !== lowest ? tip[v] : undefined;
          const head = (
            <>
              <span className="array-assign__label">
                <span className="array-assign__name">{name}</span>
                {badge && <span className="badge">{ptext(lp, badge)}</span>}
                {suggested !== undefined && (
                  <span className="array-assign__tip">{t("dist.tip", { value: String(suggested) })}</span>
                )}
                {(sum || effect) && (
                  <span className="array-assign__gives">
                    {sum && <span className="array-assign__sum">{sum}</span>}
                    {effect && <span className="array-assign__effect">{effect}</span>}
                  </span>
                )}
              </span>
              <span
                className={
                  value === undefined
                    ? "array-assign__value array-assign__value--empty"
                    : "array-assign__value"
                }
              >
                {value ?? <span className="visually-hidden">{t("dist.empty")}</span>}
              </span>
            </>
          );
          const rowClass = [
            "array-assign__row",
            fixed && "array-assign__row--fixed",
            value !== undefined && !fixed && "array-assign__row--given",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            // The whole card answers a tap; the button inside is what keyboards and
            // screen readers use. The explanation stays outside the button, so its
            // glossary words keep working (like the option cards).
            <li
              key={v}
              className={rowClass}
              onClick={(e) => {
                if (fixed || (e.target as HTMLElement).closest("button, a")) return;
                tap(v);
              }}
            >
              {fixed ? (
                <div className="array-assign__head">{head}</div>
              ) : (
                <button
                  type="button"
                  className="array-assign__head array-assign__hit"
                  aria-pressed={value !== undefined}
                  data-open-target={value === undefined || undefined}
                  onClick={() => tap(v)}
                >
                  {head}
                </button>
              )}
              {explain && (
                <span className="array-assign__explain">
                  <RichText lp={lp} text={explain} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------- number

export function NumberChoice({
  choice,
  state,
  labelledBy,
}: {
  choice: Extract<Choice, { kind: "number" }>;
  state: ChoiceState;
  labelledBy: string;
}) {
  const { t } = useApp();
  const { lp, change } = useDraft();
  const ctx = useMeasure(lp);
  const min = state.min ?? 0;
  const max = state.max ?? min;
  const stored = (state.answer as { value?: number } | undefined)?.value;
  const value = stored ?? choice.default ?? min;
  const [text, setText] = useState(String(value));
  const id = useId();

  // A good default counts as an answer: whoever just goes on keeps it (flow spec, rule 5).
  const committed = useRef(false);
  useEffect(() => {
    if (stored === undefined && !committed.current && choice.default !== undefined) {
      committed.current = true;
      change({ type: "answer", choice: choice.id, answer: { value: choice.default } });
    }
  }, [stored, choice.default, choice.id, change]);

  const set = (n: number) => {
    const clamped = Math.min(max, Math.max(min, Math.round(n)));
    setText(String(clamped));
    change({ type: "answer", choice: choice.id, answer: { value: clamped } });
  };

  if (max - min <= 4) {
    return (
      <Segmented
        legend={choiceTexts(lp, choice.id, state, ctx).question}
        legendHidden
        options={Array.from({ length: max - min + 1 }, (_, i) => ({
          value: min + i,
          label: String(min + i),
        }))}
        value={value}
        onChange={set}
      />
    );
  }
  return (
    <div className="number" role="group" aria-labelledby={labelledBy}>
      <div className="stepper stepper--wide">
        <button
          type="button"
          className="stepper__btn"
          aria-label={t("number.decrease")}
          aria-controls={id}
          onClick={() => set(value - 1)}
        >
          <Icon name="minus" />
        </button>
        <input
          id={id}
          className="stepper__input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          aria-labelledby={labelledBy}
          aria-describedby={`${id}-range`}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n) && n >= min && n <= max) {
              change({ type: "answer", choice: choice.id, answer: { value: Math.round(n) } });
            }
          }}
          onBlur={() => set(Number(text) || value)}
        />
        <button
          type="button"
          className="stepper__btn"
          aria-label={t("number.increase")}
          aria-controls={id}
          onClick={() => set(value + 1)}
        >
          <Icon name="plus" />
        </button>
      </div>
      <p className="field__help" id={`${id}-range`}>
        {t("number.range", { min, max })}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------- text

export function TextChoice({
  choice,
  state,
  label,
}: {
  choice: Extract<Choice, { kind: "text" }>;
  state: ChoiceState;
  label: string;
}) {
  const { t } = useApp();
  const { lp, change } = useDraft();
  const stored = (state.answer as { text?: string } | undefined)?.text ?? "";
  const [value, setValue] = useState(stored);
  const suggestions = choice.suggestions ? plist(lp, choice.suggestions) : [];
  const length = [...value.trim()].length;

  const set = (v: string) => {
    setValue(v);
    change({ type: "answer", choice: choice.id, answer: v.trim() ? { text: v } : null });
  };

  const problem =
    length > choice.maxLength
      ? t("text.tooLong", { max: choice.maxLength })
      : state.status === "invalid" && state.problem === "badCharacters"
        ? t("text.badCharacters")
        : undefined;

  return (
    <TextField
      id={`choice-${choice.id}`}
      label={label}
      labelExtra={choice.optional ? `(${t("text.optional")})` : undefined}
      multiline={choice.multiline ?? false}
      value={value}
      error={problem}
      maxLength={choice.maxLength + 50}
      autoComplete="off"
      help={choice.multiline ? t("text.chars", { count: length, max: choice.maxLength }) : undefined}
      onChange={(e) => set(e.target.value)}
      trailing={
        suggestions.length > 0 ? (
          <Button
            variant="secondary"
            icon="dice"
            onClick={() => {
              const others = suggestions.filter((s) => s !== value);
              const pool = others.length > 0 ? others : suggestions;
              set(pool[Math.floor(Math.random() * pool.length)]!);
            }}
          >
            {t("text.suggest")}
          </Button>
        ) : undefined
      }
    />
  );
}

// ------------------------------------------------------------------- info

/**
 * Under a gift like "Stamina +8": the number that ends up on the sheet when
 * other things add to it too, and which later step still changes it.
 */
function GiftOnSheet({ valueId, add }: { valueId: string; add: number }) {
  const { t, list } = useApp();
  const { lp, ev } = useDraft();
  const ctx = useMeasure(lp);
  if (isYesNoValue(lp, valueId)) return null;
  const exp = explainValue(lp.pkg, ev, valueId);
  const later = laterSteps(lp, ev, valueId);
  const differs = exp !== undefined && (exp.total !== add || exp.parts.length > 1);
  if (!differs && later.length === 0) return null;
  return (
    <>
      {exp && differs && (
        <p className="gift__sheet">
          {t("explain.onSheet", { total: formatValue(lp, ctx, valueId, exp.total) })}
          {exp.parts.length > 1 && ` = ${sumText(lp, ctx, ev, valueId, exp.parts, { t, list })}`}
        </p>
      )}
      {later.length > 0 && <p className="gift__later">{t("explain.later", { steps: list(later) })}</p>}
    </>
  );
}

export function InfoChoice({ state }: { state: ChoiceState }) {
  const { t, tc } = useApp();
  const { lp, ev, draft } = useDraft();
  const ctx = useMeasure(lp);
  const info = state.info;
  if (!info) return null;
  if (info.thing === null) {
    const source = ev.choices[info.of];
    const step = source?.step ?? info.of;
    const title = stepTitle(lp, ev, step);
    return (
      <Callout tone="info">
        <p>{t("flow.needsFirst", { step: title })}</p>
        <p>
          <Link href={stepHref(draft.id, step)}>{t("flow.goTo", { step: title })}</Link>
        </p>
      </Callout>
    );
  }
  const things = info.things
    .map((id) => lp.pkg.things.find((th) => th.id === id))
    .filter((x): x is Thing => !!x);
  const chosen = info.choices.filter((c) => ev.choices[c]?.status === "answered");
  const order = ev.steps.map((s) => s.id);
  const here = order.indexOf(state.step);
  const later = info.choices.filter(
    (c) => !chosen.includes(c) && order.indexOf(ev.choices[c]?.step ?? "") > here,
  );
  if (things.length === 0 && info.values.length === 0 && info.choices.length === 0) {
    return <p>{t("info.nothing")}</p>;
  }
  // Numbers without an explanation of their own (a table by level, such as
  // places per rank) share one card: nine cards of "+2" would bury the rest.
  const explained = info.values.filter((v) => ptext(lp, `value.${v.value}.explain`));
  const plainValues = info.values.filter((v) => !ptext(lp, `value.${v.value}.explain`));
  // Things a higher level brings fold away under the level they come at, so
  // a level-20 character sees first what everyone starts with.
  const min = lp.pkg.flow.level.min;
  const from = new Map(ev.things.map((h) => [h.id, h.atLevel]));
  const atStart = things.filter((th) => (from.get(th.id) ?? min) <= min);
  const higher = things.filter((th) => (from.get(th.id) ?? min) > min);
  const laterLevels = [...new Set(higher.map((th) => from.get(th.id)!))].sort((a, b) => a - b);
  const word = levelWord(lp);
  const thingCard = (th: Thing) => (
    <li className="gift" key={th.id}>
      <p className="gift__name">
        {info.counts[th.id] !== undefined
          ? t("option.count", { count: info.counts[th.id]!, name: thingName(lp, th.id) })
          : thingName(lp, th.id)}
      </p>
      <p className="gift__text">
        <RichText lp={lp} text={ptext(lp, `${th.id}.short`)} />
      </p>
      <Disclosure more={t("common.moreInfo")} less={t("common.lessInfo")}>
        <OptionDetails lp={lp} thing={th} level={ev.level} />
      </Disclosure>
    </li>
  );
  return (
    <div className="gifts">
      <ul className="gifts__list">
        {explained.map((v) => (
          <li className="gift" key={`v-${v.value}`}>
            <p className="gift__name">{grantedValue(lp, ctx, v.value, v.add, ev.values[v.value])}</p>
            <p className="gift__text">
              <RichText lp={lp} text={ptext(lp, `value.${v.value}.explain`)} />
            </p>
            <GiftOnSheet valueId={v.value} add={v.add} />
          </li>
        ))}
        {plainValues.length > 0 && (
          <li className="gift">
            <ul className="gift__numbers">
              {plainValues.map((v) => (
                <li key={v.value}>{grantedValue(lp, ctx, v.value, v.add, ev.values[v.value])}</li>
              ))}
            </ul>
          </li>
        )}
        {atStart.map(thingCard)}
      </ul>
      {higher.length > 0 && (
        <Disclosure
          className="gifts__later"
          more={tc("info.higherMore", higher.length, { levelName: word, level: ev.level })}
          less={t("common.lessInfo")}
        >
          {laterLevels.map((lv) => (
            <div className="gifts__level" key={lv}>
              <p className="gifts__choices-title">{t("flow.fromLevel", { levelName: word, level: lv })}</p>
              <ul className="gifts__list">{higher.filter((th) => from.get(th.id) === lv).map(thingCard)}</ul>
            </div>
          ))}
        </Disclosure>
      )}
      {/* Granted choices usually sit right after the step that grants them,
          so by the info step they are answered: say so, never "next". A
          choice gathered at a later step (SPEC 9.4) is named with that step. */}
      {[
        { title: t("info.chosen"), ids: chosen },
        { title: t("info.later"), ids: later },
        {
          title: t("info.choices"),
          ids: info.choices.filter((c) => !chosen.includes(c) && !later.includes(c)),
        },
      ].map(
        (group) =>
          group.ids.length > 0 && (
            <div className="gifts__choices" key={group.title}>
              <p className="gifts__choices-title">{group.title}</p>
              <ul>
                {group.ids.map((c) => (
                  <li key={c}>
                    {choiceTexts(lp, c, ev.choices[c], ctx).title}
                    {later.includes(c) &&
                      stepTitle(lp, ev, ev.choices[c]!.step) !==
                        choiceTexts(lp, c, ev.choices[c], ctx).title && (
                        <span className="gifts__where">
                          {" "}
                          ({t("info.laterAt", { step: stepTitle(lp, ev, ev.choices[c]!.step) })})
                        </span>
                      )}
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  );
}
