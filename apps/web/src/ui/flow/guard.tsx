"use client";
/**
 * Asks before a change that makes later choices stop fitting (flow spec
 * 2.5). Nothing is deleted: going back restores the old choices, and the
 * dialog says so. The safe button is focused and Escape keeps everything.
 */
import { applyChange, type DraftChange } from "@builder/core";
import { useCallback, useState, type ReactNode } from "react";
import { useApp } from "../app-state.tsx";
import { ConfirmDialog } from "../components/Dialog.tsx";
import { useDraft } from "./draft-state.tsx";
import { consequences, stepTitle, type Consequence } from "./model.ts";

export interface GuardWords {
  /** Dialog title, e.g. "Change calling?". */
  title: string;
  /** Sentence above the list. */
  lead: string;
  /** Sentence below the list. */
  after: string;
}

interface Pending {
  change: DraftChange;
  words: GuardWords;
  items: Consequence[];
  onKeep?: (() => void) | undefined;
}

export function useGuardedChange(): {
  /** `onKeep` runs when the player keeps things as they were in the dialog. */
  request(change: DraftChange, words: () => GuardWords, onKeep?: () => void): boolean;
  dialog: ReactNode;
} {
  const { t, tc } = useApp();
  const { lp, doc, ev, change } = useDraft();
  const [pending, setPending] = useState<Pending | null>(null);

  const request = useCallback(
    (c: DraftChange, words: () => GuardWords, onKeep?: () => void) => {
      const next = applyChange(lp.pkg, doc, c);
      if (!next.ok) return false;
      const items = consequences(lp.pkg, doc, next.doc);
      if (items.length === 0) return change(c);
      setPending({ change: c, words: words(), items, onKeep });
      return true;
    },
    [lp, doc, change],
  );

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.words.title ?? ""}
      cancelLabel={t("change.keep")}
      confirmLabel={t("change.confirm")}
      onCancel={() => {
        pending?.onKeep?.();
        setPending(null);
      }}
      onConfirm={() => {
        if (pending) change(pending.change);
        setPending(null);
      }}
    >
      {pending && (
        <>
          <p>{pending.words.lead}</p>
          <ul className="consequences">
            {pending.items.map((i) => {
              const title = stepTitle(lp, ev, ev.choices[i.choice]?.step ?? i.choice);
              const state = ev.choices[i.choice];
              return (
                <li key={i.choice}>
                  {state?.kind === "pickMany" ? tc("change.picked", i.picked, { title }) : title}
                </li>
              );
            })}
          </ul>
          <p>{pending.words.after}</p>
        </>
      )}
    </ConfirmDialog>
  );

  return { request, dialog };
}
