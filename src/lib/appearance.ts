// How the app looks on this device: the color theme and the text size.
// Kept in browser storage (per device, not in backups) and applied before the first paint.
export const THEMES = [
  { value: "system", label: "システムに合わせる" },
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
] as const;
export type Theme = (typeof THEMES)[number]["value"];
export const TEXT_SIZES = [
  { value: "standard", label: "標準", scale: 1 },
  { value: "large", label: "大", scale: 1.15 },
  { value: "larger", label: "特大", scale: 1.3 },
  { value: "largest", label: "最大", scale: 1.5 },
] as const;
export type TextSize = (typeof TEXT_SIZES)[number]["value"];
/** How much larger than standard the text is; sizes set in pixels, such as a note's, grow with it. */
export function textScale(size: TextSize) { return TEXT_SIZES.find((option) => option.value === size)?.scale ?? 1; }
export type Appearance = { theme: Theme; textSize: TextSize };
export const THEME_KEY = "fussenn:theme", TEXT_SIZE_KEY = "fussenn:text-size";
export const DEFAULT_APPEARANCE: Appearance = { theme: "system", textSize: "standard" };

export function parseAppearance(theme: string | null, textSize: string | null): Appearance {
  return {
    theme: THEMES.find((option) => option.value === theme)?.value ?? DEFAULT_APPEARANCE.theme,
    textSize: TEXT_SIZES.find((option) => option.value === textSize)?.value ?? DEFAULT_APPEARANCE.textSize,
  };
}
export function readAppearance(): Appearance {
  try { return parseAppearance(localStorage.getItem(THEME_KEY), localStorage.getItem(TEXT_SIZE_KEY)); }
  // A copy: the shared object stands for "not read yet" during hydration (see AppearanceSync).
  catch { return { ...DEFAULT_APPEARANCE }; }
}
export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  root.dataset.theme = appearance.theme;
  root.style.setProperty("--text-scale", String(TEXT_SIZES.find((option) => option.value === appearance.textSize)?.scale ?? 1));
  // The desktop app also matches its window frame, menus and dialogs.
  void window.fussennDesktop?.setTheme?.(appearance.theme).catch(() => {});
}
export function saveAppearance(appearance: Appearance) {
  try { localStorage.setItem(THEME_KEY, appearance.theme); localStorage.setItem(TEXT_SIZE_KEY, appearance.textSize); }
  catch { /* Still applies until the page is closed. */ }
  applyAppearance(appearance);
}
const scales = Object.fromEntries(TEXT_SIZES.map((option) => [option.value, option.scale]));
const themes = THEMES.map((option) => option.value);
/** Inline script for the page head, so a saved dark theme or larger text never flashes in the default look. */
export const APPEARANCE_SCRIPT = `(function(){var d=document.documentElement,t=${JSON.stringify(DEFAULT_APPEARANCE.theme)},s=1;try{var v=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(${JSON.stringify(themes)}.indexOf(v)>=0)t=v;var z=${JSON.stringify(scales)}[localStorage.getItem(${JSON.stringify(TEXT_SIZE_KEY)})];if(typeof z==="number")s=z}catch(e){}d.dataset.theme=t;d.style.setProperty("--text-scale",String(s))})()`;
