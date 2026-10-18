import { z } from "zod";
import { AppError, safeError } from "./errors";
import { guardWorkspaceWrite } from "./workspace-revision";

export function guardLocalRequest(request: Request) {
  if (process.env.FUSSENN_DESKTOP_TOKEN && request.headers.get("x-fussenn-desktop-token") !== process.env.FUSSENN_DESKTOP_TOKEN) {
    throw new AppError("Fussennアプリから接続してください。", 403);
  }
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(`http://${host}`).hostname)) throw new AppError("ローカル接続のみ利用できます。", 403);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== host) throw new AppError("別のサイトからのリクエストは許可されていません。", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new AppError("別のサイトからのリクエストは許可されていません。", 403);
}
export async function readBody<T>(request: Request, schema: z.ZodType<T>, maxLength = 100_000): Promise<T> {
  const body = await request.text();
  guardWorkspaceWrite(request);
  if (body.length > maxLength) throw new AppError("入力が長すぎます。", 413);
  try { return schema.parse(JSON.parse(body)); }
  catch { throw new AppError("入力内容を確認してください。"); }
}
export function errorResponse(error: unknown) {
  return Response.json({ error: safeError(error) }, { status: error instanceof AppError ? error.status : 500 });
}
