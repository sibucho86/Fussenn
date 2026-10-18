export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function safeError(error: unknown) {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "生成を中断しました。保存済みの内容は残っています。";
  return "処理を完了できませんでした。しばらく待って、もう一度お試しください。";
}
