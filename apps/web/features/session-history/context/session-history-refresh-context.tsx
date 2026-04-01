"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type SessionHistoryRefreshContextValue = {
  /** Increments when session checkpoint history should be re-fetched (e.g. after clarification). */
  version: number;
  bumpSessionHistory: () => void;
};

const SessionHistoryRefreshContext = createContext<SessionHistoryRefreshContextValue | null>(null);

export function SessionHistoryRefreshProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const bumpSessionHistory = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);
  const value = useMemo(
    () => ({ version, bumpSessionHistory }),
    [version, bumpSessionHistory]
  );
  return (
    <SessionHistoryRefreshContext.Provider value={value}>{children}</SessionHistoryRefreshContext.Provider>
  );
}

export function useSessionHistoryVersion(): number {
  return useContext(SessionHistoryRefreshContext)?.version ?? 0;
}

export function useBumpSessionHistory(): () => void {
  const ctx = useContext(SessionHistoryRefreshContext);
  return ctx?.bumpSessionHistory ?? (() => {});
}
