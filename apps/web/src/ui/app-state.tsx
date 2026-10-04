"use client";
/**
 * Who is logged in, which language the screen shows and which units the
 * reader wants. Before login the language comes from a cookie or the
 * browser; after login the account setting wins.
 */
import { effectiveUnits } from "@builder/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isUiLanguage, translator, type Translator, type UiLanguage } from "../i18n/index.ts";
import { api, ApiError, type Account } from "./api.ts";
import { loadPackageStructure, loadPackageList } from "./packages.ts";

/** Remembers the language chosen before login. Functional only; nothing else is stored. */
export const LANGUAGE_COOKIE = "lang";

function rememberLanguage(lang: UiLanguage) {
  document.cookie = `${LANGUAGE_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
}

export interface AppState extends Translator {
  /** undefined while loading, null when logged out. */
  account: Account | null | undefined;
  accountError: boolean;
  reloadAccount(): Promise<Account | null>;
  setAccount(account: Account | null): void;
  setLanguage(lang: UiLanguage): Promise<void>;
  setUnit(dimension: string, unit: string): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp outside AppStateProvider");
  return ctx;
}

export function AppStateProvider({
  initialLanguage,
  maybeSignedIn = true,
  children,
}: {
  initialLanguage: UiLanguage;
  /** False when the server saw no session: the account is null without asking (no 401 in the console). */
  maybeSignedIn?: boolean;
  children: ReactNode;
}) {
  const [account, setAccount] = useState<Account | null | undefined>(maybeSignedIn ? undefined : null);
  const [accountError, setAccountError] = useState(false);
  const [guestLanguage, setGuestLanguage] = useState<UiLanguage>(initialLanguage);

  const lang: UiLanguage = account && isUiLanguage(account.language) ? account.language : guestLanguage;

  const reloadAccount = useCallback(async () => {
    try {
      const r = await api<{ account: Account }>("GET", "/api/account");
      setAccount(r.account);
      setAccountError(false);
      return r.account;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAccount(null);
        setAccountError(false);
        return null;
      }
      setAccountError(true);
      throw error;
    }
  }, []);

  useEffect(() => {
    if (maybeSignedIn) reloadAccount().catch(() => {});
  }, [reloadAccount, maybeSignedIn]);

  useEffect(() => {
    document.documentElement.lang = lang;
    rememberLanguage(lang);
  }, [lang]);

  const setLanguage = useCallback(
    async (next: UiLanguage) => {
      if (!account) {
        setGuestLanguage(next);
        return;
      }
      // Units never follow a language change (plan 5.6): pin what the reader sees now.
      const units: Record<string, string> = {};
      try {
        const list = await loadPackageList(lang);
        for (const p of list) {
          const structure = await loadPackageStructure(p.id);
          Object.assign(units, effectiveUnits(structure.units, lang, account.units), account.units);
        }
      } catch {
        // Without package data the units stay as they are stored.
      }
      const r = await api<{ account: Account }>("PATCH", "/api/account/settings", {
        language: next,
        ...(Object.keys(units).length > 0 ? { units } : {}),
      });
      setGuestLanguage(next);
      setAccount(r.account);
    },
    [account, lang],
  );

  const setUnit = useCallback(async (dimension: string, unit: string) => {
    const r = await api<{ account: Account }>("PATCH", "/api/account/settings", {
      units: { [dimension]: unit },
    });
    setAccount(r.account);
  }, []);

  const logout = useCallback(async () => {
    await api("POST", "/api/auth/logout", {});
    setAccount(null);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ...translator(lang),
      account,
      accountError,
      reloadAccount,
      setAccount,
      setLanguage,
      setUnit,
      logout,
    }),
    [lang, account, accountError, reloadAccount, setLanguage, setUnit, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
