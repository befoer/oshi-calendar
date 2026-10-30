import { useSyncExternalStore } from "react";

export type BangumiConnection = "gateway" | "direct";
const storageKey = "oshi-bangumi-connection";
const listeners = new Set<() => void>();
let current: BangumiConnection = "gateway";
try {
  if (localStorage.getItem(storageKey) === "direct") current = "direct";
} catch {
  // Private browsing can disable localStorage; switching still works this session.
}

export const getBangumiConnection = () => current;
export function subscribeBangumiConnection(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setBangumiConnection(value: BangumiConnection) {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    /* Session-only choice. */
  }
  for (const listener of listeners) listener();
}
export function useBangumiConnection() {
  return useSyncExternalStore(subscribeBangumiConnection, getBangumiConnection);
}
