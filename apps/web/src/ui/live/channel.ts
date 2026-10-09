"use client";
/**
 * The live channel of one character (API.md "Live help"): who else is on
 * it, where they are and what they point at, the character's new state the
 * moment anyone changes it, and short hints. While someone else is on
 * the character, changes go over the channel too, so everyone learns who
 * made them; otherwise they go over HTTP (draft-state.tsx), with the same
 * answers and errors. A lost connection loses nothing; it is opened again with the
 * same URL, and the server sends the current state on joining.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftChange } from "@builder/core";
import { ApiError, type DraftView } from "../api.ts";
import { clientId } from "./client-id.ts";
import { helpTokenFor } from "./help-token.ts";

export type Role = "owner" | "gameMaster" | "helper";

/** How someone is on the character, or how a change was made: in a browser, a program with a key, or MCP. */
export type Via = "browser" | "api" | "mcp";

/** Who made a change and how (API.md "Messages"). */
export interface Source {
  via: Via;
  name: string;
  role: Role;
  /** The window's id, if a browser window made it. */
  clientId: string | null;
  connectionId: string | null;
}

/** What a change was about. */
export type Change =
  | { kind: "answer"; choice: string }
  | { kind: "pool"; step: string }
  /** The levels moved between tracks; the line names it as the level. */
  | { kind: "tracks" }
  | { kind: "level"; level: number }
  | { kind: "levelUp"; level: number }
  | {
      kind: "state" | "clearChecks";
      stateVersion: number;
      /** The play state fields that changed, at most a few; `more`: others did too. */
      fields?: string[];
      more?: boolean;
    }
  | { kind: "copyCreated" | "copyChanged" | "copyDeleted"; copyId: string };

/** A change of the character the channel tells, other than of the draft itself. */
export interface OtherEvent {
  type: "playState" | "copies" | "campaign" | "deleted";
  version: number;
  source: Source | null;
  change?: Change;
}

export interface Person {
  /** The connection's id: one person in two tabs is there twice. */
  id: string;
  name: string;
  role: Role;
  via: Via;
  clientId: string | null;
  /** Where they are: a step key, "overview", "level", "done", "raise"; null before they said. */
  step: string | null;
  /** What they point at: an option's thing id; null for nothing. */
  point: string | null;
}

/**
 * "connecting": the first try. "open": connected. "lost": the connection
 * went and is tried again. "gone": no reach (any more), not tried again.
 */
export type Connection = "connecting" | "open" | "lost" | "gone";

export interface Hint {
  /** Counts up: a new hint with the same words is still a new one. */
  seq: number;
  from: { id: string; name: string };
  text: string;
  /** Sent from this window. */
  mine: boolean;
}

export type StateMessage = DraftView & {
  by: { id: string; name: string } | null;
  stale?: boolean;
  ref?: string;
  /** Only after a change: what happened, who made it, and to what. */
  event?: "changed" | "levelUp" | "finished";
  source?: Source;
  change?: Change;
};

/** A change made in this window (over HTTP or the channel): the screen has it already. */
export function isOwn(source: Source | null | undefined): boolean {
  return source?.clientId === clientId();
}

/** The state as GET /api/drafts/:id has it, without what the live channel adds. */
export function viewOf(m: StateMessage): DraftView {
  const { draft, packageAvailable, evaluation, summary, levelUp } = m;
  return { draft, packageAvailable, evaluation, summary, levelUp };
}

export interface LiveChannel {
  connection: Connection;
  /** This window, once connected. */
  you: Person | null;
  /** Everyone connected, this window too, in the order they came. */
  people: Person[];
  hint: Hint | null;
  dismissHint(): void;
  /** Where this window is now; said again after every reconnect. */
  sendStep(step: string | null): void;
  sendPoint(target: string | null): void;
  /** False when the channel is not open: nothing was sent. */
  sendHint(text: string): boolean;
  /**
   * Sends a change over the channel; null when it is not open or nobody
   * else is there (send it over HTTP then). Answers as the HTTP route would: the new state, or an
   * ApiError (`versionConflict` with `current`, `changeRejected`, network).
   */
  sendChange(version: number, change: DraftChange): Promise<DraftView> | null;
}

/** The longest hint the server takes. */
export const HINT_MAX = 500;

/** Waits before connecting again: quick at first, then calmer. */
const RETRY_MS = [1000, 2000, 5000, 10000];

/** A change not answered in this time counts as lost; saving tries again (over HTTP if need be). */
const CHANGE_TIMEOUT_MS = 10_000;

/** Close codes after which trying again cannot help (API.md). */
const GONE_CODES = new Set([4401, 4404]);

function liveUrl(draftId: string): string {
  const token = helpTokenFor(draftId);
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return (
    `${scheme}://${location.host}/api/live/drafts/${encodeURIComponent(draftId)}` +
    `?clientId=${clientId()}` +
    (token ? `&help=${encodeURIComponent(token)}` : "")
  );
}

export function useLiveChannel(
  draftId: string,
  handlers: {
    /** A new state of the character, from whoever changed it (also from this window over HTTP). */
    onState(m: StateMessage): void;
    /** The play state, a kept sheet or the campaign changed, or the character was deleted. */
    onEvent(m: OtherEvent): void;
    /** No reach (any more): the character is gone, or the help link ended. */
    onGone(code: number): void;
  },
): LiveChannel {
  const [connection, setConnection] = useState<Connection>("connecting");
  const [you, setYou] = useState<Person | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [hint, setHint] = useState<Hint | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const youRef = useRef<Person | null>(null);
  // What this window last said, to say it again on a new connection.
  const step = useRef<string | null>(null);
  const point = useRef<string | null>(null);
  const on = useRef(handlers);
  useEffect(() => {
    on.current = handlers;
  });
  const seq = useRef(0);
  const waiting = useRef(
    new Map<string, { resolve: (v: DraftView) => void; reject: (e: ApiError) => void }>(),
  );
  const refs = useRef(0);
  const company = useRef(false);

  const sendRaw = useCallback((m: object): boolean => {
    const s = socket.current;
    if (!s || s.readyState !== WebSocket.OPEN) return false;
    s.send(JSON.stringify(m));
    return true;
  }, []);

  useEffect(() => {
    if (typeof WebSocket === "undefined") return;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      timer = undefined;
      let s: WebSocket;
      try {
        s = new WebSocket(liveUrl(draftId));
      } catch {
        retry();
        return;
      }
      socket.current = s;
      s.onmessage = (e) => {
        let m: { type?: unknown } & Record<string, unknown>;
        try {
          m = JSON.parse(String(e.data)) as typeof m;
        } catch {
          return;
        }
        switch (m.type) {
          case "welcome":
            failures = 0;
            youRef.current = m["you"] as Person;
            setYou(youRef.current);
            setConnection("open");
            if (step.current !== null) sendRaw({ type: "step", step: step.current });
            if (point.current !== null) sendRaw({ type: "point", target: point.current });
            break;
          case "presence": {
            const all = m["people"] as Person[];
            company.current = all.some((p) => p.id !== youRef.current?.id);
            setPeople(all);
            break;
          }
          case "state": {
            const state = m as unknown as StateMessage;
            const w = state.ref !== undefined ? waiting.current.get(state.ref) : undefined;
            if (w) {
              waiting.current.delete(state.ref!);
              if (state.stale) w.reject(new ApiError(409, "versionConflict", { current: viewOf(state) }));
              else w.resolve(viewOf(state));
            }
            on.current.onState(state);
            break;
          }
          case "playState":
          case "copies":
          case "campaign":
          case "deleted":
            on.current.onEvent(m as unknown as OtherEvent);
            break;
          case "error": {
            const ref = m["ref"];
            const w = typeof ref === "string" ? waiting.current.get(ref) : undefined;
            if (!w) break;
            waiting.current.delete(ref as string);
            // Too many messages is no answer to the change: saving tries again.
            w.reject(
              m["code"] === "tooManyRequests"
                ? new ApiError(0, "network")
                : new ApiError(422, String(m["code"]), m as Record<string, unknown>),
            );
            break;
          }
          case "hint": {
            const from = m["from"] as Hint["from"];
            seq.current += 1;
            setHint({
              seq: seq.current,
              from,
              text: String(m["text"]),
              mine: from.id === youRef.current?.id,
            });
            break;
          }
        }
      };
      s.onclose = (e) => {
        if (socket.current === s) socket.current = null;
        // Changes still waiting for an answer: saving tries them again.
        for (const w of waiting.current.values()) w.reject(new ApiError(0, "network"));
        waiting.current.clear();
        if (stopped) return;
        setPeople([]);
        company.current = false;
        if (GONE_CODES.has(e.code)) {
          setConnection("gone");
          on.current.onGone(e.code);
          return;
        }
        setConnection("lost");
        retry();
      };
    };

    const retry = () => {
      if (stopped || timer !== undefined) return;
      const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]!;
      failures++;
      timer = setTimeout(connect, wait);
    };

    // Back online, or back to the tab: try now instead of waiting.
    const now = () => {
      if (stopped || socket.current || timer === undefined) return;
      clearTimeout(timer);
      connect();
    };
    const visible = () => {
      if (document.visibilityState === "visible") now();
    };
    window.addEventListener("online", now);
    document.addEventListener("visibilitychange", visible);
    connect();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("online", now);
      document.removeEventListener("visibilitychange", visible);
      const s = socket.current;
      socket.current = null;
      s?.close(1000);
    };
  }, [draftId, sendRaw]);

  const sendStep = useCallback(
    (next: string | null) => {
      if (step.current === next) return;
      step.current = next;
      sendRaw({ type: "step", step: next });
    },
    [sendRaw],
  );

  const sendPoint = useCallback(
    (target: string | null) => {
      if (point.current === target) return;
      point.current = target;
      sendRaw({ type: "point", target });
    },
    [sendRaw],
  );

  const sendHint = useCallback(
    (text: string) => {
      const clean = text.trim().slice(0, HINT_MAX);
      return clean.length > 0 && sendRaw({ type: "hint", text: clean });
    },
    [sendRaw],
  );

  const dismissHint = useCallback(() => setHint(null), []);

  const sendChange = useCallback(
    (version: number, change: DraftChange): Promise<DraftView> | null => {
      refs.current += 1;
      const ref = `c${refs.current}`;
      const body =
        change.type === "answer"
          ? { type: "answer", ref, version, choice: change.choice, answer: change.answer }
          : change.type === "pool"
            ? { type: "pool", ref, version, step: change.step, picks: change.picks }
            : change.type === "tracks"
              ? { type: "tracks", ref, version, tracks: change.tracks }
              : { type: "setLevel", ref, version, level: change.level };
      if (!company.current || !sendRaw(body)) return null;
      return new Promise<DraftView>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.current.delete(ref);
          reject(new ApiError(0, "network"));
        }, CHANGE_TIMEOUT_MS);
        waiting.current.set(ref, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
      });
    },
    [sendRaw],
  );

  return useMemo(
    () => ({ connection, you, people, hint, dismissHint, sendStep, sendPoint, sendHint, sendChange }),
    [connection, you, people, hint, dismissHint, sendStep, sendPoint, sendHint, sendChange],
  );
}
