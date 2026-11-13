import type { ProviderKind } from "./types";

/** Effort names are short identifiers such as "low" or "xhigh". */
export const EFFORT_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
export type EffortChoice = { value: string; label: string };
const EFFORT_LABELS: Record<string, string> = { none: "なし", minimal: "最小", low: "低", medium: "中", high: "高", xhigh: "とても高い", max: "最大", ultra: "ウルトラ" };
export function effortLabel(value: string) { return EFFORT_LABELS[value] ?? value; }
/** Levels offered when the provider cannot list what a model supports. */
export const GENERIC_EFFORTS = ["low", "medium", "high"];
/** The OpenAI-compatible provider talks to arbitrary servers, which have no common way to set either option. */
export function supportsChatOptions(kind: ProviderKind) { return kind !== "openai-compatible"; }
type ListedModel = { model: string; efforts: string[]; defaultEffort: string | null };
/**
 * The effort levels to offer for a conversation's model, and the one to use.
 * Codex lists what each model supports; for other providers "" means "send no effort".
 */
export function effortMenu(kind: ProviderKind, model: string, codexModels: ListedModel[], preferred: string): { choices: EffortChoice[]; value: string } | null {
  if (kind === "codex") {
    const entry = codexModels.find((m) => m.model === model);
    const efforts = entry?.efforts ?? [];
    if (!entry || !efforts.length) return null;
    const value = efforts.includes(preferred) ? preferred : entry.defaultEffort ?? efforts[0];
    return { choices: efforts.map((effort) => ({ value: effort, label: effortLabel(effort) + (effort === entry.defaultEffort ? "（標準）" : "") })), value };
  }
  if (!supportsChatOptions(kind)) return null;
  return { choices: [{ value: "", label: "標準" }, ...GENERIC_EFFORTS.map((effort) => ({ value: effort, label: effortLabel(effort) }))], value: GENERIC_EFFORTS.includes(preferred) ? preferred : "" };
}
/** Words for a pending answer's progress line and for screen readers. */
export function activityLabel(kind: "thinking" | "searching" | "reading" | "writing") {
  return { thinking: "考えています", searching: "Webで調べています", reading: "ページを読んでいます", writing: "回答を書いています" }[kind];
}
