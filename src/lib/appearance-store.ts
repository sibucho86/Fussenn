"use client";
import { useSyncExternalStore } from "react";
import { applyAppearance, DEFAULT_APPEARANCE, readAppearance, saveAppearance, TEXT_SIZE_KEY, THEME_KEY, type Appearance } from "./appearance";

const listeners = new Set<() => void>();
let current: Appearance | null = null;
function snapshot() { return current ??= readAppearance(); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  const fromOtherWindow = (event: StorageEvent) => {
    // A null key means another window cleared all of this site's storage.
    if (event.key !== null && event.key !== THEME_KEY && event.key !== TEXT_SIZE_KEY) return;
    current = readAppearance(); applyAppearance(current); listener();
  };
  window.addEventListener("storage", fromOtherWindow);
  return () => { listeners.delete(listener); window.removeEventListener("storage", fromOtherWindow); };
}
export function setAppearance(patch: Partial<Appearance>) {
  current = { ...snapshot(), ...patch };
  saveAppearance(current);
  for (const listener of listeners) listener();
}
export function useAppearance() { return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_APPEARANCE); }
