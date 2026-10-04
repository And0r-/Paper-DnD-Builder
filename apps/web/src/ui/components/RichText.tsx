"use client";
/**
 * Package texts on screen: quantities converted into the reader's units
 * (formatMeasure in the rule core), glossary words as buttons that open
 * the explanation in place.
 */
import { renderText, type MeasureContext } from "@builder/core";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useApp } from "../app-state.tsx";
import { measureContext, ptext } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import { Button } from "./Button.tsx";
import { Dialog } from "./Dialog.tsx";

export function useMeasure(lp: LoadedPackage): MeasureContext {
  const { account } = useApp();
  const units = account?.units;
  return useMemo(() => measureContext(lp, units), [lp, units]);
}

interface GlossaryApi {
  open(lp: LoadedPackage, id: string): void;
}

const GlossaryCtx = createContext<GlossaryApi | null>(null);

export function GlossaryProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<{ lp: LoadedPackage; id: string } | null>(null);
  const open = useCallback((lp: LoadedPackage, id: string) => setEntry({ lp, id }), []);
  const api = useMemo(() => ({ open }), [open]);
  return (
    <GlossaryCtx.Provider value={api}>
      {children}
      <GlossarySheet entry={entry} onClose={() => setEntry(null)} />
    </GlossaryCtx.Provider>
  );
}

function GlossarySheet({
  entry,
  onClose,
}: {
  entry: { lp: LoadedPackage; id: string } | null;
  onClose: () => void;
}) {
  const { t } = useApp();
  const lp = entry?.lp;
  const key = entry ? `glossary.${entry.id}` : "";
  return (
    <Dialog
      open={entry !== null}
      onClose={onClose}
      variant="sheet"
      title={lp ? (ptext(lp, `${key}.name`) ?? "") : ""}
      footer={
        <Button variant="secondary" onClick={onClose} block>
          {t("common.close")}
        </Button>
      }
    >
      {lp && (
        <div className="glossary">
          <p className="glossary__short">
            <RichText lp={lp} text={ptext(lp, `${key}.short`)} />
          </p>
          <p>
            <RichText lp={lp} text={ptext(lp, `${key}.explain.what`)} />
          </p>
          <p>
            <RichText lp={lp} text={ptext(lp, `${key}.explain.table`)} />
          </p>
          {ptext(lp, `${key}.explain.example`) && (
            <p className="glossary__example">
              <RichText lp={lp} text={ptext(lp, `${key}.explain.example`)} />
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** One package text. Renders nothing for a missing text. */
export function RichText({
  lp,
  text,
  vars,
}: {
  lp: LoadedPackage;
  text: string | undefined;
  vars?: Record<string, string | number>;
}) {
  const ctx = useMeasure(lp);
  const glossary = useContext(GlossaryCtx);
  if (text === undefined) return null;
  const parts = renderText(ctx, text, vars);
  return (
    <>
      {parts.map((p, i) =>
        p.type === "text" ? (
          <span key={i}>{p.text}</span>
        ) : (
          <button
            key={i}
            type="button"
            className="glossary-term"
            aria-haspopup="dialog"
            onClick={(e) => {
              // Inside an option card: explaining a word must not pick the option.
              e.preventDefault();
              e.stopPropagation();
              glossary?.open(lp, p.id);
            }}
          >
            {p.text}
          </button>
        ),
      )}
    </>
  );
}
