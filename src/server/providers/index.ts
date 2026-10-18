import type { ProviderKind, Settings } from "@/lib/types";
import type { ChatProvider } from "./provider";
import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import { CompatibleProvider } from "./openai-compatible";
import { CodexProvider } from "./codex";
import { AppError } from "@/server/errors";

export function resolveProvider(kind: ProviderKind, settings?: Settings): ChatProvider {
  if (kind === "mock" && process.env.ENABLE_MOCK_PROVIDER === "true") return new MockProvider();
  if (kind === "openai") return new OpenAIProvider();
  if (kind === "codex") return new CodexProvider();
  if (kind === "openai-compatible") {
    if (!settings?.compatibleBaseUrl) throw new AppError("Compatible APIのBase URLを設定してください。");
    return new CompatibleProvider(settings.compatibleBaseUrl);
  }
  throw new AppError("このProviderはまだ利用できません。設定を確認してください。");
}
