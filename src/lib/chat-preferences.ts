"use client";
import { useSyncExternalStore } from "react";

// The last choices in the composer, kept on this device and shared by the main chat and every note.
const EFFORT_KEY = "fussenn:chat-effort", WEB_SEARCH_KEY = "fussenn:chat-web-search";
export type ChatPreferences = { effort: string; webSearch: boolean };
const DEFAULTS: ChatPreferences = { effort: "", webSearch: false };
const listeners = new Set<() => void>();
let current: ChatPreferences | null = null;
function read(): ChatPreferences {
  try { return { effort: localStorage.getItem(EFFORT_KEY) ?? "", webSearch: localStorage.getItem(WEB_SEARCH_KEY) === "true" }; }
  catch { return DEFAULTS; }
}
function snapshot() { return current ??= read(); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  // A null key means another window cleared all of this site's storage.
  const fromOtherWindow = (event: StorageEvent) => { if (event.key === null || event.key === EFFORT_KEY || event.key === WEB_SEARCH_KEY) { current = read(); listener(); } };
  window.addEventListener("storage", fromOtherWindow);
  return () => { listeners.delete(listener); window.removeEventListener("storage", fromOtherWindow); };
}
export function setChatPreferences(patch: Partial<ChatPreferences>) {
  current = { ...snapshot(), ...patch };
  try { localStorage.setItem(EFFORT_KEY, current.effort); localStorage.setItem(WEB_SEARCH_KEY, String(current.webSearch)); }
  catch { /* The choice still applies until the page is closed. */ }
  for (const listener of listeners) listener();
}
export function useChatPreferences() { return useSyncExternalStore(subscribe, snapshot, () => DEFAULTS); }
