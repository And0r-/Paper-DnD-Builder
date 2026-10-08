"use client";
/**
 * One character draft on screen. The draft lives on the server; every
 * change is sent right away, one after another, each on the version it was
 * made on. The screen shows the change at once: the rule core runs in the
 * browser too, on the same package, so what you see is what the server
 * will compute.
 *
 * Saving never blocks the player. On failure it retries after 2, 5, 10 and
 * then every 30 seconds (sooner when the browser comes back online) and the
 * top bar says so (flow spec 2.4).
 *
 * Others may build on the same character at the same time (live help,
 * AND-246): the owner, the game master of its campaign, a helper with the
 * help link. The live channel (live/channel.ts) brings every new state
 * from the server; this window takes it and puts its own changes that are
 * still on their way back on top. After an answer the server's state
 * counts, always: there are never two truths. A change of this window to a
 * question that someone else saved meanwhile gives way: the stored one
 * counts, and the short line says so (AND-258).
 */
import {
  applyChange,
  evaluateDraft,
  type DraftChange,
  type DraftDocument,
  type Evaluation,
} from "@builder/core";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useApp } from "../app-state.tsx";
import { api, ApiError, type DraftInfo, type DraftView } from "../api.ts";
import {
  isOwn,
  useLiveChannel,
  viewOf,
  type Change,
  type LiveChannel,
  type OtherEvent,
} from "../live/channel.ts";
import { setFlash } from "../live/flash.ts";
import { draftPath, forgetHelpToken, helpTokenFor } from "../live/help-token.ts";
import { stepOfPath } from "../live/where.ts";
import type { Told } from "../live/words.ts";
import { draftPackageKey, usePackage, type LoadedPackage } from "../packages.ts";
import { buildFlow, stepDiff, stepTitle, type FlowEntry } from "./model.ts";
import { planDiff, plannedDraft } from "./plan.ts";
import { flowOf, type Raise } from "./raise.ts";
import { answeredParts } from "./step-changes.ts";

export type SaveState = "saved" | "saving" | "error" | "offline";

type Pending = DraftChange;

/** Two queued changes of the same thing: only the newer one needs to be sent. */
function sameTarget(a: Pending, b: Pending): boolean {
  if (a.type === "setLevel") return b.type === "setLevel";
  if (a.type === "answer") return b.type === "answer" && a.choice === b.choice;
  if (a.type === "tracks") return b.type === "tracks";
  return b.type === "pool" && a.step === b.step;
}

function send(id: string, version: number, next: Pending): Promise<DraftView> {
  switch (next.type) {
    case "setLevel":
      return api<DraftView>("PATCH", draftPath(id), { version, level: next.level });
    case "answer":
      return api<DraftView>("PUT", draftPath(id, `/answers/${encodeURIComponent(next.choice)}`), {
        version,
        answer: next.answer,
      });
    case "pool":
      return api<DraftView>("PUT", draftPath(id, `/pools/${encodeURIComponent(next.step)}`), {
        version,
        picks: next.picks,
      });
    case "tracks":
      return api<DraftView>("PUT", draftPath(id, "/tracks"), { version, tracks: next.tracks });
  }
}

/**
 * Whether the server's state changed what `p` changes: the answer to its
 * question, the answers of its list step, or the level.
 */
function touched(before: DraftView, after: DraftView, p: Pending): boolean {
  if (p.type === "setLevel") return before.draft.level !== after.draft.level;
  const choices =
    p.type === "answer" ? [p.choice] : (after.evaluation?.steps.find((s) => s.id === p.step)?.choices ?? []);
  return choices.some(
    (c) => JSON.stringify(before.draft.answers[c]) !== JSON.stringify(after.draft.answers[c]),
  );
}

/** Whether a change the channel told was to the same question as `p`. */
function hits(change: Change | undefined, p: Pending, view: DraftView): boolean {
  if (!change) return false;
  const inStep = (step: string, choice: string) =>
    view.evaluation?.steps.find((s) => s.id === step)?.choices.includes(choice) ?? false;
  switch (change.kind) {
    case "answer":
      return p.type === "answer" ? p.choice === change.choice : p.type === "pool" && inStep(p.step, change.choice);
    case "pool":
      return p.type === "pool" ? p.step === change.step : p.type === "answer" && inStep(change.step, p.choice);
    case "level":
    case "levelUp":
      return p.type === "setLevel";
    default:
      return false;
  }
}

/** What else the live channel tells, for a screen that shows more than the draft (the sheet). */
export type LiveNews = OtherEvent | { type: "draft"; version: number };

/** Titles of steps a change added or removed: counted steps, and parts of a step. */
export interface StepNotice {
  added: string[];
  removed: string[];
  /** Steps that were there before and now ask more (a gather step got a new choice). */
  grown: string[];
  addedParts: string[];
  removedParts: string[];
}

export interface DraftApi {
  lp: LoadedPackage;
  draft: DraftInfo;
  doc: DraftDocument;
  ev: Evaluation;
  /** The steps to go through; during a raise only those the new levels bring. */
  entries: FlowEntry[];
  /** Every step, for the overview: during a raise the earlier ones stay reachable there. */
  allEntries: FlowEntry[];
  /** Set while a finished character is being raised and not finished again. */
  raise: Raise | null;
  saveState: SaveState;
  /**
   * Set when a change was refused (by the server, or here because the
   * numbers do not fit); the screen shows it once. `problem` is the rule
   * core's reason, for words that say what to do.
   */
  rejected: { problem?: string } | null;
  clearRejected(): void;
  notice: StepNotice | null;
  /** Applies a change on screen at once and queues it for the server. False if it does not fit now. */
  change(c: DraftChange): boolean;
  /** Resolves when everything is saved (true) or saving failed for now (false). */
  flush(): Promise<boolean>;
  finish(): Promise<"ok" | "incomplete" | "failed">;
  /**
   * Raises the character to a higher level on the server. "finished" when
   * the new level asks nothing, so the character is done again at once.
   */
  levelUp(level: number): Promise<"open" | "finished" | "failed">;
  /** Puts the character into a campaign its owner plays in, or into none (null). False if that failed. */
  setCampaign(campaignId: string | null): Promise<boolean>;
  /** Who else is on the character, where, pointing at what; hints (live help). */
  live: LiveChannel;
  /** Someone else, another window or a program just changed the character: for a short line. */
  told: Told | null;
  /** Hears of every change made elsewhere; returns the way to stop. */
  listen(f: (news: LiveNews) => void): () => void;
  /**
   * Switches the package's extensions for this character. The screen then
   * loads the package with them. "inUse": an answer still comes from one
   * that would go off.
   */
  setExtensions(extensions: string[]): Promise<"ok" | "inUse" | "failed">;
}

const Ctx = createContext<DraftApi | null>(null);

export function useDraft(): DraftApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDraft outside DraftProvider");
  return ctx;
}

const NUMBER_PROBLEMS = new Set(["overBudget", "outOfRange", "badAssignment"]);

const BACKOFF_MS = [2000, 5000, 10000, 30000];

function apply(pkg: LoadedPackage["pkg"], doc: DraftDocument, queue: readonly Pending[]): DraftDocument {
  let d = doc;
  for (const p of queue) {
    const r = applyChange(pkg, d, p);
    if (r.ok) d = r.doc;
  }
  return d;
}

function docOf(view: DraftView): DraftDocument {
  const { level, levelBefore, answers } = view.draft;
  return levelBefore === null ? { level, answers } : { level, levelBefore, answers };
}

export type DraftLoad =
  | { state: "loading" }
  | { state: "notFound" }
  /** A helper's help link ended: withdrawn, replaced or over. */
  | { state: "helpEnded" }
  | { state: "packageUnavailable" }
  | { state: "error"; retry: () => void }
  | { state: "ready"; api: DraftApi };

/** Loads the draft and its package; children get the draft through {@link useDraft}. */
export function DraftProvider({
  draftId,
  children,
}: {
  draftId: string;
  children: (load: DraftLoad) => ReactNode;
}) {
  const { lang, t } = useApp();
  const [view, setView] = useState<DraftView | null>(null);
  const [loadError, setLoadError] = useState<"notFound" | "helpEnded" | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const helping = helpTokenFor(draftId) !== null;
    api<DraftView>("GET", draftPath(draftId)).then(
      (v) => {
        if (!live) return;
        setView(v);
        setLoadError(null);
      },
      (error: unknown) => {
        if (!live) return;
        if (!(error instanceof ApiError && error.status === 404)) setLoadError("error");
        else if (helping) {
          forgetHelpToken(draftId);
          setLoadError("helpEnded");
        } else setLoadError("notFound");
      },
    );
    return () => {
      live = false;
    };
  }, [draftId, attempt]);

  const pkg = usePackage(view?.packageAvailable ? draftPackageKey(view.draft) : undefined, lang);

  let load: DraftLoad;
  if (loadError === "notFound") load = { state: "notFound" };
  else if (loadError === "helpEnded") load = { state: "helpEnded" };
  else if (loadError === "error") load = { state: "error", retry: () => setAttempt((n) => n + 1) };
  else if (!view) load = { state: "loading" };
  else if (!view.packageAvailable) load = { state: "packageUnavailable" };
  else if (pkg.state === "error") load = { state: "error", retry: pkg.retry };
  else if (pkg.state === "loading") load = { state: "loading" };
  else
    return (
      <ReadyDraft
        initial={view}
        onServer={setView}
        onGone={setLoadError}
        lp={pkg.value}
        t={t}
        render={children}
      />
    );
  return <>{children(load)}</>;
}

function ReadyDraft({
  initial,
  onServer,
  onGone,
  lp,
  t,
  render,
}: {
  initial: DraftView;
  /** Keeps the loader's copy current, so a remount starts from the newest state. */
  onServer: (v: DraftView) => void;
  /** The live channel says there is no reach (any more). */
  onGone: (why: "notFound" | "helpEnded") => void;
  lp: LoadedPackage;
  t: ReturnType<typeof useApp>["t"];
  render: (load: DraftLoad) => ReactNode;
}) {
  const [server, setServerState] = useState<DraftView>(initial);
  const [doc, setDocState] = useState<DraftDocument>(() => docOf(initial));
  // Changes can follow each other faster than React renders: always build on the newest document.
  const docRef = useRef(doc);
  const setDoc = useCallback((d: DraftDocument) => {
    docRef.current = d;
    setDocState(d);
  }, []);
  const setServer = useCallback(
    (v: DraftView) => {
      setServerState(v);
      onServer(v);
    },
    [onServer],
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [rejected, setRejected] = useState<{ problem?: string } | null>(null);
  const [notice, setNotice] = useState<StepNotice | null>(null);

  const serverRef = useRef(initial);
  const queue = useRef<Pending[]>([]);
  const running = useRef(false);
  const wake = useRef<(() => void) | null>(null);
  const waiters = useRef<((ok: boolean) => void)[]>([]);
  const pkg = lp.pkg;

  // ------------------------------------------------------------ live help
  const [told, setTold] = useState<Told | null>(null);
  const tell = useCallback((next: Omit<Told, "seq">) => setTold((c) => ({ ...next, seq: (c?.seq ?? 0) + 1 })), []);
  const youId = useRef<string | null>(null);
  const listeners = useRef(new Set<(news: LiveNews) => void>());
  const listen = useCallback((f: (news: LiveNews) => void) => {
    listeners.current.add(f);
    return () => void listeners.current.delete(f);
  }, []);
  // The change on its way that someone else's saved change to the same question beat.
  const beaten = useRef<Pending | null>(null);
  // A change of ours a conflict dropped before the channel said who beat it.
  const gaveWay = useRef(false);
  const deleted = useRef(false);
  const router = useRouter();
  const live = useLiveChannel(initial.draft.id, {
    onState: (m) => {
      const elsewhere = m.event !== undefined && !isOwn(m.source) && !(m.by && m.by.id === youId.current);
      let overruled = false;
      // Keep the highest version: an answer of ours may have brought it already.
      if (m.draft.version > serverRef.current.draft.version) {
        const v = viewOf(m);
        if (elsewhere) {
          // Ours to the same question, not saved yet, give way: the stored one counts.
          const from = running.current ? 1 : 0;
          const kept = queue.current.filter((p, i) => i < from || !hits(m.change, p, v));
          overruled = kept.length < queue.current.length;
          queue.current = kept;
          const sending = running.current ? queue.current[0] : undefined;
          if (sending && hits(m.change, sending, v)) {
            beaten.current = sending;
            overruled = true;
          }
        }
        serverRef.current = v;
        setServer(v);
        // Ours still on their way stay on top (not one that gave way); saving sends them on this version.
        setDoc(apply(pkg, docOf(v), queue.current.filter((p) => p !== beaten.current)));
        if (elsewhere) for (const f of listeners.current) f({ type: "draft", version: v.draft.version });
      }
      if (elsewhere && m.source) {
        tell({ source: m.source, event: m.event!, change: m.change, overruled: overruled || gaveWay.current });
        gaveWay.current = false;
      }
    },
    onEvent: (m) => {
      if (m.type === "deleted") {
        // Everyone is put out right after: back to the list, which says why.
        deleted.current = true;
        setFlash(t("live.deleted"));
        router.replace("/characters");
        return;
      }
      if (isOwn(m.source) || !m.source) return;
      tell({ source: m.source, event: m.type, change: m.change, overruled: false });
      if (m.type === "campaign") {
        // The version stays; only where the character belongs changed.
        void api<DraftView>("GET", draftPath(serverRef.current.draft.id)).then(
          (v) => {
            serverRef.current = {
              ...serverRef.current,
              draft: { ...serverRef.current.draft, campaignId: v.draft.campaignId },
            };
            setServer(serverRef.current);
          },
          () => {},
        );
      }
      for (const f of listeners.current) f(m);
    },
    onGone: (code) => {
      if (code !== 4404 || deleted.current) return;
      if (helpTokenFor(initial.draft.id) !== null) {
        forgetHelpToken(initial.draft.id);
        onGone("helpEnded");
      } else onGone("notFound");
    },
  });
  useEffect(() => {
    youId.current = live.you?.id ?? null;
  }, [live.you]);
  const sendChange = useRef(live.sendChange);
  useEffect(() => {
    sendChange.current = live.sendChange;
  }, [live.sendChange]);

  const ev = useMemo(() => evaluateDraft(pkg, doc), [pkg, doc]);
  const flow = useMemo(() => flowOf(server.draft.id, lp, doc, ev, t), [server.draft.id, lp, doc, ev, t]);

  const settle = useCallback((ok: boolean) => {
    const w = waiters.current;
    waiters.current = [];
    for (const f of w) f(ok);
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const slow = setTimeout(() => setSaveState((s) => (s === "saved" ? "saving" : s)), 400);
    let failures = 0;
    try {
      while (queue.current.length > 0) {
        const next = queue.current[0]!;
        const id = serverRef.current.draft.id;
        const version = serverRef.current.draft.version;
        try {
          // Over the live channel while it is open, so the others learn who it was.
          const res = await (sendChange.current(version, next) ?? send(id, version, next));
          // The channel may have brought a newer state already.
          if (res.draft.version > serverRef.current.draft.version) {
            serverRef.current = res;
            setServer(res);
          }
          if (beaten.current === next) beaten.current = null;
          queue.current.shift();
          failures = 0;
          if (queue.current.length > 0) setSaveState("saving");
        } catch (error) {
          if (error instanceof ApiError && error.code === "versionConflict" && error.details["current"]) {
            // Changed elsewhere (another tab): take the current state and send ours on top of it,
            // unless it was the same question: then the stored one counts.
            const current = error.details["current"] as DraftView;
            if (beaten.current === next || touched(serverRef.current, current, next)) {
              if (beaten.current !== next) gaveWay.current = true;
              beaten.current = null;
              queue.current.shift();
            }
            serverRef.current = current;
            setServer(current);
            setDoc(apply(pkg, docOf(current), queue.current));
            continue;
          }
          if (
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 408
          ) {
            // Refused for good (does not fit, gone): drop it and show the server's state.
            queue.current.shift();
            const reason = error.details["reason"] as { problem?: unknown } | undefined;
            setRejected(typeof reason?.problem === "string" ? { problem: reason.problem } : {});
            setDoc(apply(pkg, docOf(serverRef.current), queue.current));
            continue;
          }
          setSaveState(error instanceof ApiError && error.isNetwork ? "offline" : "error");
          settle(false);
          const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]!;
          failures++;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, wait);
            wake.current = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wake.current = null;
        }
      }
      setDoc(docOf(serverRef.current));
      setSaveState("saved");
      settle(true);
    } finally {
      clearTimeout(slow);
      running.current = false;
    }
  }, [pkg, settle, setDoc, setServer]);

  useEffect(() => {
    const online = () => wake.current?.();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (queue.current.length > 0) e.preventDefault();
    };
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  // A note about added or removed steps belongs to the screen where the change happened.
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  const { sendStep, sendPoint, dismissHint } = live;
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      setNotice(null);
      setRejected(null);
      // A hint and a pointer belong to the step they were given on.
      dismissHint();
      sendPoint(null);
    }
    // The others see where this window is.
    sendStep(stepOfPath(pathname));
  }, [pathname, sendStep, sendPoint, dismissHint]);

  const change = useCallback(
    (c: DraftChange): boolean => {
      const r = applyChange(pkg, docRef.current, c);
      if (!r.ok) {
        // Numbers that do not fit (too many points, a value over its limit)
        // are said in words; other refusals stay with the screen that tried.
        if (r.error.code === "answerDoesNotFit" && NUMBER_PROBLEMS.has(r.error.problem))
          setRejected({ problem: r.error.problem });
        return false;
      }
      setRejected(null);
      // The count follows the planned flow (plan.ts), so the note compares the plans:
      // it speaks exactly when "Step x of y" or "Part x of y" changes.
      const before = evaluateDraft(pkg, plannedDraft(lp, docRef.current));
      const after = evaluateDraft(pkg, plannedDraft(lp, r.doc));
      // Parts of a step are said only once the player answered it, or when the
      // step gathers its parts by level: not those a suggestion brings (AND-100).
      const diff = planDiff(
        buildFlow("", lp, before, t),
        buildFlow("", lp, after, t),
        answeredParts({ before: docRef.current.answers, after: r.doc.answers }),
      );
      const grown = stepDiff(before, after).grown.map((s) => stepTitle(lp, after, s));
      if (
        diff.added.length > 0 ||
        diff.removed.length > 0 ||
        diff.addedParts.length > 0 ||
        diff.removedParts.length > 0 ||
        grown.length > 0
      )
        setNotice({ ...diff, grown });
      setDoc(r.doc);
      const item: Pending = c;
      // Typing sends many changes to one choice: keep only the newest one that is not on its way yet.
      const from = running.current ? 1 : 0;
      const same = queue.current.findIndex((p, i) => i >= from && sameTarget(p, item));
      if (same >= 0) queue.current[same] = item;
      else queue.current.push(item);
      void pump();
      return true;
    },
    [pkg, lp, t, pump, setDoc],
  );

  const flush = useCallback((): Promise<boolean> => {
    if (queue.current.length === 0 && !running.current) return Promise.resolve(true);
    wake.current?.();
    return new Promise((resolve) => waiters.current.push(resolve));
  }, []);

  const finish = useCallback(async (): Promise<"ok" | "incomplete" | "failed"> => {
    if (!(await flush())) return "failed";
    try {
      const res = await api<DraftView>("POST", draftPath(serverRef.current.draft.id, "/finish"), {
        version: serverRef.current.draft.version,
      });
      serverRef.current = res;
      setServer(res);
      // Finishing ends a raise.
      setDoc(docOf(res));
      return "ok";
    } catch (error) {
      if (error instanceof ApiError && error.code === "incomplete") return "incomplete";
      return "failed";
    }
  }, [flush, setServer, setDoc]);

  const levelUp = useCallback(
    async (level: number): Promise<"open" | "finished" | "failed"> => {
      if (!(await flush())) return "failed";
      try {
        const res = await api<DraftView>("POST", draftPath(serverRef.current.draft.id, "/level-up"), {
          version: serverRef.current.draft.version,
          level,
        });
        serverRef.current = res;
        setServer(res);
        setDoc(docOf(res));
        return res.draft.status === "finished" ? "finished" : "open";
      } catch {
        return "failed";
      }
    },
    [flush, setServer, setDoc],
  );

  const setCampaign = useCallback(
    async (campaignId: string | null): Promise<boolean> => {
      try {
        await api<DraftView>("PUT", `/api/drafts/${serverRef.current.draft.id}/campaign`, { campaignId });
        // The version stays: only the campaign changes in what we hold, whatever is on its way.
        serverRef.current = { ...serverRef.current, draft: { ...serverRef.current.draft, campaignId } };
        setServer(serverRef.current);
        return true;
      } catch {
        return false;
      }
    },
    [setServer],
  );

  const setExtensions = useCallback(
    async (extensions: string[]): Promise<"ok" | "inUse" | "failed"> => {
      if (!(await flush())) return "failed";
      try {
        const res = await api<DraftView>("PATCH", `/api/drafts/${serverRef.current.draft.id}`, {
          version: serverRef.current.draft.version,
          extensions,
        });
        serverRef.current = res;
        // Another package now: the loader above fetches it and shows the draft with it.
        setServer(res);
        return "ok";
      } catch (error) {
        return error instanceof ApiError && error.code === "extensionInUse" ? "inUse" : "failed";
      }
    },
    [flush, setServer],
  );

  const value = useMemo<DraftApi>(
    () => ({
      lp,
      draft: server.draft,
      doc,
      ev,
      entries: flow.entries,
      allEntries: flow.all,
      raise: flow.raise,
      saveState,
      rejected,
      clearRejected: () => setRejected(null),
      notice,
      change,
      flush,
      finish,
      levelUp,
      setCampaign,
      live,
      told,
      listen,
      setExtensions,
    }),
    [
      lp,
      server.draft,
      doc,
      ev,
      flow,
      saveState,
      rejected,
      notice,
      change,
      flush,
      finish,
      levelUp,
      setCampaign,
      live,
      told,
      listen,
      setExtensions,
    ],
  );
  return <Ctx.Provider value={value}>{render({ state: "ready", api: value })}</Ctx.Provider>;
}
