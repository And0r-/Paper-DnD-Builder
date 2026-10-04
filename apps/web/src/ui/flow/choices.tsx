"use client";
/**
 * The six kinds of questions (flow spec 3): pickOne, pickMany, distribute,
 * number, text, info. Every option explains itself where it is chosen.
 */
import { formatMeasure, type ChoiceState } from "@builder/core";
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
  choiceTexts,
  distributeMethodLabels,
  grantedValue,
  plain,
  plist,
  ptext,
  thingName,
} from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import { useDraft } from "./draft-state.tsx";
import { useExplain } from "./frame.tsx";
import { useGuardedChange } from "./guard.tsx";
import { stepHref, stepTitle } from "./model.ts";

// ------------------------------------------------------------ explanation

function Stats({ lp, thing }: { lp: LoadedPackage; thing: Thing }) {
  const { t } = useApp();
  const ctx = useMeasure(lp);
  const entries = Object.entries(thing.stats ?? {});
  if (entries.length === 0) return null;
  return (
    <dl className="stats">
      {entries.map(([key, v]) => {
        let shown: string;
        if (typeof v === "number") shown = new Intl.NumberFormat(lp.lang).format(v);
        else if (typeof v === "boolean") shown = v ? t("common.yes") : t("common.no");
        else if ("amount" in v) shown = formatMeasure(ctx, v, "long");
        else shown = plain(ctx, ptext(lp, v.text));
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
    items.push(<li key={`v-${value}`}>{grantedValue(lp, ctx, value, add)}</li>);
  }
  for (const [i, g] of (thing.grants ?? []).entries()) {
    if ((g.atLevel ?? 1) > level) continue;
    if (g.thing) items.push(<li key={i}>{thingName(lp, g.thing)}</li>);
    else if (g.choice)
      items.push(<li key={i}>{t("option.youChoose", { title: choiceTexts(lp, g.choice).title })}</li>);
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

function OptionCard({
  lp,
  thing,
  type,
  name,
  checked,
  recommended,
  badge,
  level,
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
  onToggle: () => void;
}) {
  const { t } = useApp();
  const explain = useExplain();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
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
      className={`option${checked ? " option--checked" : ""}`}
      onClick={(e) => {
        // The whole card picks the option, except its own buttons and links.
        if ((e.target as HTMLElement).closest("button, a, input, label, select, textarea")) return;
        input.current?.click();
      }}
      onFocus={showExplain}
      onMouseEnter={showExplain}
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
          onChange={onToggle}
          aria-describedby={`${id}-short`}
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

function groupOptions(things: Thing[]): { group: string | undefined; things: Thing[] }[] {
  if (!things.some((th) => th.group)) return [{ group: undefined, things }];
  const groups: { group: string | undefined; things: Thing[] }[] = [];
  for (const th of things) {
    let g = groups.find((x) => x.group === th.group);
    if (!g) {
      g = { group: th.group, things: [] };
      groups.push(g);
    }
    g.things.push(th);
  }
  return groups;
}

const SEARCH_FROM = 12;

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
      {shown.length === 0 && <p className="options__none">{t("pick.noResults")}</p>}
      {groupOptions(shown).map((g) => (
        <div className="options__group" key={g.group ?? "-"}>
          {g.group && <h2 className="options__group-title">{ptext(lp, `group.${g.group}.name`)}</h2>}
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
}: {
  choice: Extract<Choice, { kind: "distribute" }>;
  state: ChoiceState;
  labelledBy: string;
}) {
  const { t, tc, list } = useApp();
  const { lp, ev } = useDraft();
  const guard = useGuardedChange();
  const stored = state.answer as { method: number; assign: Record<string, number> } | undefined;
  const [method, setMethod] = useState<number>(stored?.method ?? 0);
  const m = choice.methods[method]!;
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

  const save = (assign: Record<string, number>) => {
    mine.current = sign({ method, assign });
    return guard.request({ type: "answer", choice: choice.id, answer: { method, assign } }, () => ({
      title: t("change.title", { step: stepName }),
      lead: t("change.textGeneric"),
      after: t("change.afterGeneric"),
    }));
  };

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
          onChange={setMethod}
        />
      )}
      {m.method === "pointBuy" ? (
        <PointBuy
          key={`pb-${method}-${round}`}
          lp={lp}
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
          targets={choice.targets}
          values={m.values}
          initial={stored?.method === method ? stored.assign : undefined}
          onSave={save}
        />
      )}
      {guard.dialog}
    </fieldset>
  );
}

function PointBuy({
  lp,
  targets,
  costs,
  budget,
  initial,
  onSave,
  tc,
}: {
  lp: LoadedPackage;
  targets: string[];
  costs: Record<string, number>;
  budget: number;
  initial: Record<string, number> | undefined;
  onSave: (assign: Record<string, number>) => void;
  tc: ReturnType<typeof useApp>["tc"];
}) {
  const { t } = useApp();
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
      <p className="pointbuy__left" aria-live="polite">
        {tc("dist.left", left)}
      </p>
      {hint && (
        <p className="pointbuy__hint" role="status">
          {hint}
        </p>
      )}
      <ul className="pointbuy__rows">
        {targets.map((v) => {
          const score = assign[v] ?? low;
          const name = ptext(lp, `value.${v}.name`) ?? v;
          return (
            <li className="pointbuy__row" key={v}>
              <div className="pointbuy__label">
                <span className="pointbuy__name" id={`pb-${v}`}>
                  {name}
                </span>
                {ptext(lp, `value.${v}.explain`) && (
                  <span className="pointbuy__explain">
                    <RichText lp={lp} text={ptext(lp, `value.${v}.explain`)} />
                  </span>
                )}
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
                <output className="stepper__value" aria-labelledby={`pb-${v}`} aria-live="polite">
                  {score}
                </output>
                <button
                  type="button"
                  className="stepper__btn"
                  aria-label={t("dist.increase", { name })}
                  aria-disabled={score >= high || undefined}
                  onClick={() => score < high && set(v, score + 1)}
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

function ArrayAssign({
  lp,
  targets,
  values,
  initial,
  onSave,
}: {
  lp: LoadedPackage;
  targets: string[];
  values: number[];
  initial: Record<string, number> | undefined;
  onSave: (assign: Record<string, number>) => void;
}) {
  const { t } = useApp();
  const [assign, setAssign] = useState<Record<string, number | undefined>>(() => initial ?? {});
  const complete = targets.every((v) => assign[v] !== undefined);

  const set = (v: string, raw: string) => {
    const next = { ...assign, [v]: raw === "" ? undefined : Number(raw) };
    setAssign(next);
    if (targets.every((x) => next[x] !== undefined)) onSave(next as Record<string, number>);
  };

  // Each number of the row may be used once; count how often each is still free.
  const usedCount = (n: number, except: string) =>
    targets.filter((x) => x !== except && assign[x] === n).length;
  const available = (n: number, except: string) =>
    values.filter((x) => x === n).length - usedCount(n, except) > 0;

  return (
    <div className="array-assign">
      <p className="array-assign__hint">{t("dist.arrayHint")}</p>
      <ul className="array-assign__rows">
        {targets.map((v) => {
          const id = `arr-${v}`;
          return (
            <li key={v} className="array-assign__row">
              <label htmlFor={id} className="array-assign__name">
                {ptext(lp, `value.${v}.name`)}
              </label>
              <select
                id={id}
                className="select"
                value={assign[v] ?? ""}
                onChange={(e) => set(v, e.target.value)}
              >
                <option value="">{t("dist.choose")}</option>
                {[...new Set(values)].map((n) => (
                  <option key={n} value={n} disabled={!available(n, v)}>
                    {available(n, v) ? String(n) : `${n} (${t("dist.used")})`}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      {!complete && <p className="array-assign__missing">{t("dist.arrayMissing")}</p>}
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
        legend={choiceTexts(lp, choice.id).question}
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

export function InfoChoice({ state }: { state: ChoiceState }) {
  const { t } = useApp();
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
  if (things.length === 0 && info.values.length === 0 && info.choices.length === 0) {
    return <p>{t("info.nothing")}</p>;
  }
  return (
    <div className="gifts">
      <ul className="gifts__list">
        {info.values.map((v) => (
          <li className="gift" key={`v-${v.value}`}>
            <p className="gift__name">{grantedValue(lp, ctx, v.value, v.add)}</p>
            {ptext(lp, `value.${v.value}.explain`) && (
              <p className="gift__text">
                <RichText lp={lp} text={ptext(lp, `value.${v.value}.explain`)} />
              </p>
            )}
          </li>
        ))}
        {things.map((th) => (
          <li className="gift" key={th.id}>
            <p className="gift__name">{thingName(lp, th.id)}</p>
            <p className="gift__text">
              <RichText lp={lp} text={ptext(lp, `${th.id}.short`)} />
            </p>
            <Disclosure more={t("common.moreInfo")} less={t("common.lessInfo")}>
              <OptionDetails lp={lp} thing={th} level={ev.level} />
            </Disclosure>
          </li>
        ))}
      </ul>
      {info.choices.length > 0 && (
        <div className="gifts__choices">
          <p className="gifts__choices-title">{t("info.choices")}</p>
          <ul>
            {info.choices.map((c) => (
              <li key={c}>{choiceTexts(lp, c).title}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
