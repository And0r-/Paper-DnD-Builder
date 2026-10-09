"use client";
/**
 * The screens for more than one track (concept AND-262, section 6): the
 * level-up question and the builder's step "Your levels". They work on the
 * character's plan and on what the rule core says about each track
 * (`evaluation.tracks`). Words like "calling" come from the package; the
 * builder's own sentences never name one.
 */
import type { TrackOption } from "@builder/core";
import { useEffect, useId, useRef, useState } from "react";
import { useApp } from "../app-state.tsx";
import { Button } from "../components/Button.tsx";
import { Callout } from "../components/Feedback.tsx";
import { Icon } from "../components/Icon.tsx";
import { levelWord, ptext, thingName } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import {
  allFirst,
  headLine,
  isSingle,
  levelOwners,
  nextTrackLevel,
  trackLevels,
  unfitLevels,
  withLevel,
  type TrackPlan,
} from "./model.ts";

/**
 * Why a track may not be added, in the package's words: the sentence
 * `<thing>.addReason` of each thing whose condition does not hold.
 */
export function notMetText(lp: LoadedPackage, things: readonly string[] | undefined): string {
  return (things ?? [])
    .map((id) => ptext(lp, `${id}.addReason`))
    .filter((x): x is string => x !== undefined && x !== "")
    .join(" ");
}

interface Common {
  lp: LoadedPackage;
  /** The character's name; empty when it has none yet. */
  name: string;
}

/* ------------------------------------------------------------ level up */

/**
 * Level up, first question (concept 6.1): for each new level, carry on in a
 * track the character has (the one of the last level recommended) or add a
 * new one. Tracks the core refuses stay visible, greyed, with the reason.
 */
export function TrackRaise({
  lp,
  name,
  plan,
  chosen,
  to,
  options,
  busy = false,
  error,
  onBack,
  onGo,
}: Common & {
  plan: TrackPlan;
  to: number;
  options: readonly TrackOption[];
  /** The plan to start from when the raise is under way already (its levels as chosen then). */
  chosen?: TrackPlan;
  busy?: boolean;
  /** Shown above the buttons when going on failed. */
  error?: string | undefined;
  onBack: () => void;
  onGo: (plan: TrackPlan) => void;
}) {
  const { t } = useApp();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const levelName = ptext(lp, "level.name") ?? "";
  const word = levelWord(lp);
  const thing = (id: string) => thingName(lp, id);
  // Default for every new level: the track of the level before it.
  const [next, setNext] = useState<TrackPlan>(() => {
    const start = chosen
      ? { ...chosen, level: Math.min(chosen.level, to), tracks: chosen.tracks.slice(0, to - 1) }
      : plan;
    let p = start;
    for (let l = start.level + 1; l <= to; l++) p = withLevel(p, l, levelOwners(p).at(-1)!);
    return p;
  });
  useEffect(() => headingRef.current?.focus(), []);
  const many = to > plan.level + 1;
  const who = name || t("common.unnamed");
  const question = t(many ? "tracks.raise.questionMany" : "tracks.raise.question", {
    levelName,
    level: to,
    name: who,
  });
  const levels = Array.from({ length: to - plan.level }, (_, i) => plan.level + 1 + i);
  return (
    <div className="page raise tracks-raise">
      <div className="question">
        <h1 className="question__title" tabIndex={-1} ref={headingRef}>
          {question}
        </h1>
        <p className="question__intro">{t("tracks.raise.intro", { line: levelLine(lp, plan, t) })}</p>
      </div>

      {levels.map((level) => {
        const before: TrackPlan = { ...next, level: level - 1 };
        return (
          <RaiseRow
            key={level}
            lp={lp}
            level={level}
            before={before}
            chosen={levelOwners(next)[level - 1]!}
            options={options}
            many={many}
            onPick={(id) => setNext(withLevel(next, level, id))}
            thing={thing}
            word={word}
          />
        );
      })}

      <Callout tone="info">
        <strong>{t("tracks.raise.after", { line: levelLine(lp, next, t) })}</strong>{" "}
        {t("tracks.raise.afterNote")}
      </Callout>

      {error && (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      )}

      <div className="raise__actions">
        <Button variant="secondary" icon="arrowLeft" onClick={onBack}>
          {t("common.back")}
        </Button>
        <Button iconAfter="arrowRight" onClick={() => onGo(next)} busy={busy} busyLabel={t("raise.going")}>
          {t("raise.go", { levelName, level: to })}
        </Button>
      </div>
    </div>
  );
}

function RaiseRow({
  lp,
  level,
  before,
  chosen,
  options,
  many,
  onPick,
  thing,
  word,
}: {
  lp: LoadedPackage;
  level: number;
  before: TrackPlan;
  chosen: string;
  options: readonly TrackOption[];
  many: boolean;
  onPick: (thing: string) => void;
  thing: (id: string) => string;
  word: string;
}) {
  const { t } = useApp();
  const levelName = ptext(lp, "level.name") ?? "";
  const legendId = useId();
  const own = trackLevels(before).map((tl) => tl.thing);
  const last = levelOwners(before).at(-1)!;
  // The track of the last level first: it is what most players want.
  const keep = [last, ...own.filter((o) => o !== last)];
  const fresh = options.filter((o) => !own.includes(o.thing));
  // Possible new tracks first, refused ones after them.
  fresh.sort((a, b) => Number(b.allowed) - Number(a.allowed));
  const group = `raise-${level}`;
  return (
    <fieldset className="options tracks-row" aria-labelledby={legendId}>
      <legend className={many ? "tracks-row__title" : "visually-hidden"} id={legendId}>
        {t("tracks.raise.row", { levelName, level })}
      </legend>
      <div className="options__group">
        <p className="options__group-title" aria-hidden="true">
          {t("tracks.raise.keepGroup")}
        </p>
        <div className="options__list">
          {keep.map((id) => (
            <TrackCard
              key={id}
              group={group}
              id={id}
              name={t("tracks.raise.continue", { thing: thing(id) })}
              short={t("tracks.raise.continueShort", {
                thing: thing(id),
                levelName: word,
                level: nextTrackLevel(before, id),
              })}
              checked={chosen === id}
              recommended={id === last}
              onPick={onPick}
            />
          ))}
        </div>
      </div>
      {fresh.length > 0 && (
        <div className="options__group">
          <p className="options__group-title" aria-hidden="true">
            {t("tracks.raise.addGroup")}
          </p>
          <div className="options__list">
            {fresh.map((o) => (
              <TrackCard
                key={o.thing}
                group={group}
                id={o.thing}
                name={thing(o.thing)}
                short={
                  o.allowed
                    ? `${ptext(lp, `${o.thing}.short`) ?? ""} ${t("tracks.raise.addShort", { levelName: word })}`.trim()
                    : (ptext(lp, `${o.thing}.short`) ?? "")
                }
                checked={chosen === o.thing}
                blocked={
                  o.allowed ? undefined : t("tracks.raise.blocked", { reason: notMetText(lp, o.notMet) })
                }
                onPick={onPick}
              />
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
}

function TrackCard({
  group,
  id,
  name,
  short,
  checked,
  recommended,
  blocked,
  onPick,
}: {
  group: string;
  id: string;
  name: string;
  short: string;
  checked: boolean;
  recommended?: boolean;
  blocked?: string | undefined;
  onPick: (thing: string) => void;
}) {
  const { t } = useApp();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`option option--simple${checked ? " option--checked" : ""}${blocked ? " option--blocked" : ""}`}
      onClick={(e) => {
        // The whole card picks the option, as on every other step.
        if ((e.target as HTMLElement).closest("input, label")) return;
        input.current?.click();
      }}
      data-track={id}
    >
      <div className="option__head">
        <input
          ref={input}
          className="option__input"
          type="radio"
          id={inputId}
          name={group}
          value={id}
          checked={checked}
          onChange={() => !blocked && onPick(id)}
          aria-disabled={blocked ? true : undefined}
          aria-describedby={blocked ? `${inputId}-blocked ${inputId}-short` : `${inputId}-short`}
        />
        <span className="option__mark" aria-hidden="true">
          {checked && <Icon name="dot" size={14} />}
        </span>
        <label className="option__name" htmlFor={inputId}>
          {name}
        </label>
        {recommended && <span className="badge">{t("common.recommended")}</span>}
      </div>
      {blocked && (
        <p className="option__blocked" id={`${inputId}-blocked`}>
          <Icon name="info" size={18} />
          <span>{blocked}</span>
        </p>
      )}
      <p className="option__short" id={`${inputId}-short`}>
        {short}
      </p>
    </div>
  );
}

/* ------------------------------------------------------ step "your levels" */

/**
 * The builder's step after the tracks choice when a character starts above
 * level 1 (concept 6.2), under the step's own question. Closed: one
 * sentence, everything in the first track, nothing to do. Open: one row per
 * level from 2 on.
 */
export function TrackStep({
  lp,
  choice,
  plan,
  options,
  unfit,
  onChange,
}: {
  lp: LoadedPackage;
  /** The package's tracks choice (its title names the step the first track comes from). */
  choice: string;
  plan: TrackPlan;
  options: readonly TrackOption[];
  /** Added tracks whose condition no longer holds (`evaluation.tracks.unfit`). */
  unfit: readonly string[];
  onChange: (plan: TrackPlan) => void;
}) {
  const { t, list } = useApp();
  const levelName = ptext(lp, "level.name") ?? "";
  const word = levelWord(lp);
  const thing = (id: string) => thingName(lp, id);
  const [open, setOpen] = useState(!isSingle(plan) || unfit.length > 0);
  const listRef = useRef<HTMLHeadingElement>(null);
  const owners = levelOwners(plan);
  const refused = options.filter((o) => !o.allowed);
  const choiceTitle = ptext(lp, `choice.${choice}.title`) ?? "";
  return (
    <div className="tracks-step">
      {unfit.map((u) => {
        const levels = unfitLevels(plan, new Set([u]));
        if (levels.length === 0) return null;
        return (
          <Callout key={u} tone="warning" title={t("tracks.step.unfitTitle")}>
            {t("tracks.step.unfitText", {
              thing: thing(u),
              levelName: word,
              levels: list(levels.map(String)),
              reason: notMetText(lp, [u]),
            })}
          </Callout>
        );
      })}

      {!open ? (
        <div className="tracks-all">
          <p className="tracks-all__line">
            <Icon name="check" size={20} />
            <span>{t("tracks.step.all", { levelName, level: plan.level, thing: thing(plan.first) })}</span>
          </p>
          <p className="tracks-all__note">{t("tracks.step.allNote")}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => listRef.current?.focus());
            }}
          >
            {t("tracks.step.split")}
          </Button>
        </div>
      ) : (
        <section className="tracks-split" aria-labelledby="tracks-split-title">
          <h2 className="section-title" id="tracks-split-title" tabIndex={-1} ref={listRef}>
            {t("tracks.step.listTitle", { levelName: word })}
          </h2>
          <ol className="tracks-levels">
            <li className="tracks-level tracks-level--fixed">
              <span className="tracks-level__number">{t("flow.atLevel", { levelName, level: 1 })}</span>
              <span className="tracks-level__fixed">
                <strong>{thing(plan.first)}</strong>
                <span>{t("tracks.step.first", { step: choiceTitle })}</span>
              </span>
            </li>
            {owners.slice(1).map((owner, i) => {
              const level = i + 2;
              const bad = unfit.includes(owner);
              return (
                <li className={`tracks-level${bad ? " tracks-level--unfit" : ""}`} key={level}>
                  <LevelSelect
                    lp={lp}
                    label={t("flow.atLevel", { levelName, level })}
                    value={owner}
                    options={options}
                    first={plan.first}
                    bad={bad}
                    onChange={(id) => onChange(withLevel(plan, level, id))}
                  />
                </li>
              );
            })}
          </ol>
          <p className="tracks-result" aria-live="polite">
            {t("tracks.step.result", { line: levelLine(lp, plan, t) })}
          </p>
          {refused.length > 0 && (
            <div className="tracks-refused">
              <p className="tracks-refused__title">{t("tracks.step.blockedTitle")}</p>
              <ul>
                {refused.map((o) => (
                  <li key={o.thing}>
                    {t("tracks.step.blockedLine", {
                      thing: thing(o.thing),
                      reason: notMetText(lp, o.notMet),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!isSingle(plan) && (
            <p>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  onChange(allFirst(plan));
                  // The button goes away with the split: the focus waits on the list's title.
                  listRef.current?.focus();
                }}
              >
                {t("tracks.step.reset", { thing: thing(plan.first) })}
              </button>
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function LevelSelect({
  lp,
  label,
  value,
  options,
  first,
  bad,
  onChange,
}: {
  lp: LoadedPackage;
  label: string;
  value: string;
  options: readonly TrackOption[];
  first: string;
  bad: boolean;
  onChange: (thing: string) => void;
}) {
  const { t } = useApp();
  const id = useId();
  // The first track on top; a track already chosen stays choosable even when it no longer fits.
  const ordered = [...options.filter((o) => o.thing === first), ...options.filter((o) => o.thing !== first)];
  return (
    <>
      <label className="tracks-level__number" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="field__input tracks-level__select"
        value={value}
        aria-invalid={bad || undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        {ordered.map((o) => {
          const off = !o.allowed && o.thing !== value;
          return (
            <option key={o.thing} value={o.thing} disabled={off}>
              {off ? t("tracks.step.notPossible", { thing: thingName(lp, o.thing) }) : thingName(lp, o.thing)}
            </option>
          );
        })}
      </select>
    </>
  );
}

/** "A 3 / B 2" (concept 6.5); one track alone is only its name. */
export function levelLine(lp: LoadedPackage, plan: TrackPlan, t: ReturnType<typeof useApp>["t"]): string {
  const levelName = ptext(lp, "level.name") ?? "";
  if (isSingle(plan))
    return `${thingName(lp, plan.first)}, ${t("flow.atLevel", { levelName, level: plan.level })}`;
  return headLine(plan, (id) => thingName(lp, id));
}
