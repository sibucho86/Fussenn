type Save = () => Promise<boolean>;
const saves = new Set<Save>();
const writes = new Set<Promise<unknown>>();
declare global {
  interface Window {
    fussennDesktop?: { openLogin: (url: string) => Promise<void>; onBeforeClose: (save: Save) => () => void; setTheme?: (theme: "system" | "light" | "dark") => Promise<void> };
  }
}
export function registerDesktopSave(save: Save) { saves.add(save); return () => { saves.delete(save); }; }
export function trackWorkspaceWrite<T>(promise: Promise<T>) {
  writes.add(promise);
  void promise.finally(() => writes.delete(promise)).catch(() => {});
  return promise;
}
export async function flushDesktopSaves() {
  const saved = await Promise.all([...saves].map((save) => save()));
  const pending = await Promise.allSettled([...writes]);
  return saved.every(Boolean) && pending.every((result) => result.status === "fulfilled" && (!(result.value instanceof Response) || result.value.ok));
}
