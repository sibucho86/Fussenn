"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { ChevronDown, Globe, LoaderCircle } from "lucide-react";
import type { ChatOptions, ProviderKind } from "@/lib/types";
import type { CodexModel } from "@/server/providers/codex/client";
import { activityLabel, effortMenu, supportsChatOptions } from "@/lib/chat-options";
import { setChatPreferences, useChatPreferences, type ChatPreferences } from "@/lib/chat-preferences";
import type { PendingActivity } from "@/hooks/use-chat-stream";

/** The provider and model that answer in the current conversation, for the main chat and its notes. */
export type ChatSetup = { kind: ProviderKind; model: string; codexModels: CodexModel[] };
export const ChatSetupContext = createContext<ChatSetup | null>(null);
export function resolveChatControls(setup: ChatSetup | null, preferences: ChatPreferences) {
  // A document whose notes have no AI yet shows neither choice.
  const ready = setup && setup.model.trim() ? setup : null;
  const menu = ready ? effortMenu(ready.kind, ready.model, ready.codexModels, preferences.effort) : null;
  const webSearchAvailable = !!ready && supportsChatOptions(ready.kind);
  // Without a model list (Codex unreachable for now), the saved choice is still sent; the server checks it.
  const effort = menu ? menu.value || null : ready?.kind === "codex" ? preferences.effort || null : null;
  const options: ChatOptions = { effort, webSearch: webSearchAvailable && preferences.webSearch };
  return { menu, webSearchAvailable, options };
}
export function useChatControls() { return resolveChatControls(useContext(ChatSetupContext), useChatPreferences()); }
const EFFORT_HELP = "考える深さ（エフォート）。深くするほど、時間をかけて考えます。";
export function ChatOptionsBar({ compact = false, disabled = false }: { compact?: boolean; disabled?: boolean }) {
  const { menu, webSearchAvailable, options } = useChatControls();
  if (!menu && !webSearchAvailable) return null;
  return <div className={`chat-options ${compact ? "compact" : ""}`}>
    {menu && <label className="effort-control" title={EFFORT_HELP}><span>{compact ? "深さ" : "考える深さ"}</span>
      <select aria-label="考える深さ" value={menu.value} disabled={disabled} onChange={(event) => setChatPreferences({ effort: event.target.value })}>{menu.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select><ChevronDown className="chat-option-chevron" aria-hidden="true" />
    </label>}
    {webSearchAvailable && <button type="button" className="web-search-toggle" aria-pressed={options.webSearch} disabled={disabled}
      title={options.webSearch ? "Web検索をオフにする。AIは学習した知識だけで答えます。" : "Web検索をオンにする。AIが必要に応じてWebを調べ、出典を示します。"}
      onClick={() => setChatPreferences({ webSearch: !options.webSearch })}><Globe className="chat-option-icon" aria-hidden="true" />{compact ? "Web" : "Web検索"}<span>{options.webSearch ? "オン" : "オフ"}</span></button>}
  </div>;
}
function elapsedText(seconds: number) {
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`;
}
/**
 * Shows that a pending answer is still being worked on, with the time since the question was sent.
 * Screen readers hear the same steps from a live region that stays on the page (see useChatStream).
 */
export function AnswerProgress({ activity, compact = false }: { activity: PendingActivity; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - activity.startedAt) / 1000));
  const detail = activity.kind === "writing" ? undefined : activity.detail;
  return <div className={`answer-progress ${compact ? "compact" : ""}`} data-testid="answer-progress" data-kind={activity.kind}>
    <LoaderCircle className="spin answer-progress-icon" aria-hidden="true" />
    <span className="answer-progress-label">{activityLabel(activity.kind)}{detail && <span className="answer-progress-detail">{activity.kind === "searching" ? `「${detail}」` : detail}</span>}</span>
    <span className="answer-progress-time" aria-hidden="true">{elapsedText(seconds)}</span>
  </div>;
}
