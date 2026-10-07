"use client";
/**
 * The state of the online sheet: which version is shown (the original or a
 * kept copy), its model, the play state, and saving both.
 *
 * Every change is on the screen at once and saved right after, one request
 * at a time, always with what is on the screen by then: quick changes
 * coalesce, and nothing is sent twice in the wrong order. The first change
 * to the original makes a copy of it with the change already in; the
 * screen then shows that copy, and the account opens it next time. A write
 * that another device beat (409) loads what is stored and says so.
 */
import { withRowRemoved, type PlayValue, type SheetModel } from "@builder/sheet";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { api, ApiError } from "../api.ts";
import { useApp } from "../app-state.tsx";

export interface CopyEntry {
  id: string;
  createdAt: string;
  version: number;
  language: string;
}

/** "original" or a copy's id. */
export type SheetVersion = string;
export const ORIGINAL = "original";

/** Why the original cannot be shown. */
export type OriginalProblem = "notFinished" | "language" | "package";

export type SaveState = "idle" | "saving" | "saved" | "error" | "offline";

/** A short line about something the player did not do themselves. */
export type SheetNotice = "otherDevice" | "copyGone" | "limit";

/** What can be taken back for a short while: every tick rubbed out, or a row crossed out. */
export type SheetUndoKind = "checks" | "row";
interface Undo {
  kind: SheetUndoKind;
  run: () => void;
}

interface Live {
  load: "loading" | "ready" | "error";
  copies: CopyEntry[];
  max: number;
  version: SheetVersion;
  model: SheetModel | null;
  problem: OriginalProblem | null;
  copyVersion: number;
  state: Record<string, PlayValue>;
  stateVersion: number;
  save: SaveState;
  notice: SheetNotice | null;
  modelDirty: boolean;
  stateDirty: boolean;
  undo: Undo | null;
}

type CopyView = { copy: CopyEntry; model: SheetModel };

const RETRY_MS = 3000;
/** How long "undo" stays next to "saved". */
export const UNDO_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useSheet(draftId: string) {
  const { lang, account } = useApp();
  const [, render] = useReducer((n: number) => n + 1, 0);
  const live = useRef<Live>({
    load: "loading",
    copies: [],
    max: Infinity,
    version: ORIGINAL,
    model: null,
    problem: null,
    copyVersion: 0,
    state: {},
    stateVersion: 0,
    save: "idle",
    notice: null,
    modelDirty: false,
    stateDirty: false,
    undo: null,
  });
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Offers `undo` until the time is up or anything else changes. */
  const offerUndo = useCallback((undo: Undo | null) => {
    clearTimeout(undoTimer.current);
    live.current.undo = undo;
    if (undo) {
      undoTimer.current = setTimeout(() => {
        if (live.current.undo === undo) {
          live.current.undo = null;
          render();
        }
      }, UNDO_MS);
    }
  }, []);
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const base = `/api/drafts/${draftId}`;

  /** Runs `job` after every job before it; a lost connection or a server error tries again. */
  const enqueue = useCallback((job: () => Promise<void>) => {
    const S = live.current;
    pending.current++;
    S.save = "saving";
    render();
    queue.current = queue.current.then(async () => {
      for (;;) {
        try {
          await job();
          break;
        } catch (error) {
          const retry = error instanceof ApiError && (error.isNetwork || error.status >= 500);
          if (!retry) {
            S.save = "error";
            render();
            break;
          }
          S.save = (error as ApiError).isNetwork ? "offline" : "error";
          render();
          await sleep(RETRY_MS);
        }
      }
      pending.current--;
      if (pending.current === 0 && S.save !== "error") S.save = "saved";
      render();
    });
  }, []);

  const openOriginal = useCallback(async () => {
    const S = live.current;
    try {
      S.model = await api<SheetModel>("GET", `${base}/sheet`);
      S.problem = null;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const problem: OriginalProblem | null =
        error.code === "notFinished"
          ? "notFinished"
          : error.code === "languageNotSupported"
            ? "language"
            : error.code === "packageUnavailable"
              ? "package"
              : null;
      if (!problem) throw error;
      S.model = null;
      S.problem = problem;
    }
    S.version = ORIGINAL;
  }, [base]);

  const openCopy = useCallback(
    async (id: string) => {
      const S = live.current;
      const r = await api<CopyView>("GET", `${base}/sheet-copies/${id}`);
      S.model = r.model;
      S.copyVersion = r.copy.version;
      S.problem = null;
      S.version = id;
    },
    [base],
  );

  const loadList = useCallback(async () => {
    const r = await api<{ copies: CopyEntry[]; opened: string | null; max: number }>(
      "GET",
      `${base}/sheet-copies`,
    );
    live.current.copies = r.copies;
    live.current.max = r.max;
    return r.opened;
  }, [base]);

  const load = useCallback(async () => {
    const S = live.current;
    S.load = "loading";
    render();
    try {
      const [opened, play] = await Promise.all([
        loadList(),
        api<{ state: Record<string, PlayValue>; version: number }>("GET", `${base}/state`),
      ]);
      S.state = play.state;
      S.stateVersion = play.version;
      if (opened && S.copies.some((c) => c.id === opened)) await openCopy(opened);
      else await openOriginal();
      S.load = "ready";
    } catch {
      S.load = "error";
    }
    render();
  }, [base, loadList, openCopy, openOriginal]);

  useEffect(() => {
    void load();
  }, [load]);

  // The original is written in the account's language and units: it follows them.
  const unitsKey = JSON.stringify(account?.units ?? {});
  const firstSettings = useRef(true);
  useEffect(() => {
    if (firstSettings.current) {
      firstSettings.current = false;
      return;
    }
    if (live.current.load !== "ready" || live.current.version !== ORIGINAL) return;
    void openOriginal()
      .then(render)
      .catch(() => {});
  }, [lang, unitsKey, openOriginal]);

  // ------------------------------------------------------------- the model

  const saveModel = useCallback(async () => {
    const S = live.current;
    if (!S.modelDirty || !S.model) return;
    S.modelDirty = false;
    const sent = S.model;
    try {
      if (S.version === ORIGINAL) {
        const r = await api<CopyView>("POST", `${base}/sheet-copies`, { model: sent });
        S.copies = [...S.copies, r.copy];
        S.version = r.copy.id;
        S.copyVersion = r.copy.version;
        if (S.model === sent) S.model = r.model;
      } else {
        const r = await api<CopyView>("PUT", `${base}/sheet-copies/${S.version}`, {
          version: S.copyVersion,
          model: sent,
        });
        S.copyVersion = r.copy.version;
        if (S.model === sent) S.model = r.model;
      }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code === "versionConflict") {
        const current = error.details["current"] as CopyView;
        S.model = current.model;
        S.copyVersion = current.copy.version;
        S.notice = "otherDevice";
      } else if (error.code === "originalChanged") {
        await openOriginal();
        S.notice = "otherDevice";
      } else if (error.code === "tooManyCopies") {
        await loadList();
        S.max = S.copies.length;
        await openOriginal();
        S.notice = "limit";
      } else if (error.code === "copyNotFound") {
        await loadList();
        await openOriginal();
        S.notice = "copyGone";
      } else {
        throw error;
      }
      S.modelDirty = false;
      render();
      return;
    }
    // Changed again while this was on its way: that change queued its own save.
    render();
  }, [base, loadList, openOriginal]);

  const canEdit = useCallback(() => {
    const S = live.current;
    if (!S.model || S.problem) return false;
    return S.version !== ORIGINAL || S.copies.length < S.max;
  }, []);

  /** Any change to the shown model; on the original, the first change makes a copy. */
  const changeModel = useCallback(
    (change: (m: SheetModel) => SheetModel) => {
      const S = live.current;
      if (!S.model || !canEdit()) return;
      const next = change(S.model);
      if (next === S.model) return;
      S.model = next;
      S.notice = null;
      offerUndo(null);
      const queued = S.modelDirty;
      S.modelDirty = true;
      render();
      if (!queued) enqueue(saveModel);
    },
    [canEdit, enqueue, saveModel, offerUndo],
  );

  /** Crosses out a row; "undo" puts it back as long as the section was not changed since. */
  const removeRow = useCallback(
    (section: number, row: number) => {
      const S = live.current;
      const before = S.model?.sections[section];
      changeModel((m) => withRowRemoved(m, section, row));
      const after = S.model?.sections[section];
      if (!before || !after || before === after) return;
      const same = JSON.stringify(after);
      offerUndo({
        kind: "row",
        run: () =>
          changeModel((m) =>
            JSON.stringify(m.sections[section]) === same
              ? { ...m, sections: m.sections.map((s, i) => (i === section ? before : s)) }
              : m,
          ),
      });
      render();
    },
    [changeModel, offerUndo],
  );

  // ------------------------------------------------------------ play state

  const saveState = useCallback(async () => {
    const S = live.current;
    if (!S.stateDirty) return;
    S.stateDirty = false;
    const sent = S.state;
    try {
      // Kept alive: a note written just before the page is left still arrives.
      const r = await api<{ state: Record<string, PlayValue>; version: number }>(
        "PUT",
        `${base}/state`,
        { version: S.stateVersion, state: sent },
        { keepalive: true },
      );
      S.stateVersion = r.version;
      if (S.state === sent) S.state = r.state;
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "versionConflict") throw error;
      const current = error.details["current"] as { state: Record<string, PlayValue>; version: number };
      S.state = current.state;
      S.stateVersion = current.version;
      S.notice = "otherDevice";
    }
    render();
  }, [base]);

  /** Writes or rubs out one field of the play state; `undefined` rubs it out. Never makes a copy. */
  const setField = useCallback(
    (id: string, value: PlayValue | undefined) => {
      const S = live.current;
      const next = { ...S.state };
      if (value === undefined) delete next[id];
      else next[id] = value;
      S.state = next;
      S.notice = null;
      offerUndo(null);
      const queued = S.stateDirty;
      S.stateDirty = true;
      render();
      if (!queued) enqueue(saveState);
    },
    [enqueue, saveState, offerUndo],
  );

  const clearChecks = useCallback(() => {
    const S = live.current;
    const ticks = Object.fromEntries(Object.entries(S.state).filter(([, v]) => typeof v === "object"));
    S.state = Object.fromEntries(Object.entries(S.state).filter(([, v]) => typeof v !== "object"));
    S.notice = null;
    // Undo ticks again what was ticked; whatever was written since stays.
    offerUndo(
      Object.keys(ticks).length === 0
        ? null
        : {
            kind: "checks",
            run: () => {
              const S = live.current;
              S.state = { ...S.state, ...ticks };
              const queued = S.stateDirty;
              S.stateDirty = true;
              render();
              if (!queued) enqueue(saveState);
            },
          },
    );
    render();
    enqueue(async () => {
      try {
        const r = await api<{ state: Record<string, PlayValue>; version: number }>("PUT", `${base}/state`, {
          version: S.stateVersion,
          clearChecks: true,
        });
        S.state = r.state;
        S.stateVersion = r.version;
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "versionConflict") throw error;
        const current = error.details["current"] as { state: Record<string, PlayValue>; version: number };
        S.state = current.state;
        S.stateVersion = current.version;
        S.notice = "otherDevice";
      }
      render();
    });
  }, [base, enqueue, saveState, offerUndo]);

  // -------------------------------------------------------------- versions

  /** Shows another version once everything changed so far is saved; the account opens it next time. */
  const select = useCallback(
    (version: SheetVersion) => {
      const S = live.current;
      if (version === S.version) return;
      S.notice = null;
      offerUndo(null);
      enqueue(async () => {
        if (version === ORIGINAL) await openOriginal();
        else await openCopy(version);
        render();
        await api("PUT", `${base}/sheet-view`, { copyId: version === ORIGINAL ? null : version }).catch(
          () => {},
        );
      });
    },
    [base, enqueue, openCopy, openOriginal, offerUndo],
  );

  const S = live.current;
  return useMemo(
    () => ({
      load: S.load,
      reload: load,
      copies: S.copies,
      max: S.max,
      version: S.version,
      model: S.model,
      problem: S.problem,
      state: S.state,
      save: S.save,
      notice: S.notice,
      dismissNotice: () => {
        live.current.notice = null;
        render();
      },
      editable: canEdit(),
      undo: S.undo?.kind ?? null,
      /** Takes back the last "clear all ticks" or crossed-out row, once. */
      runUndo: () => {
        const undo = live.current.undo;
        if (!undo) return;
        offerUndo(null);
        undo.run();
        render();
      },
      atLimit: S.version === ORIGINAL && S.copies.length >= S.max,
      changeModel,
      removeRow,
      setField,
      clearChecks,
      select,
    }),
    // `live` is read at render: its fields are the dependencies.
    [
      S.load,
      S.copies,
      S.max,
      S.version,
      S.model,
      S.problem,
      S.state,
      S.save,
      S.notice,
      S.undo,
      load,
      canEdit,
      changeModel,
      removeRow,
      offerUndo,
      setField,
      clearChecks,
      select,
    ],
  );
}

export type SheetController = ReturnType<typeof useSheet>;
