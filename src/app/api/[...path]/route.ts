import { z } from "zod";
import { dataDirectory, getDatabase, getDatabaseHandle } from "@/server/db";
import { Store } from "@/server/services/store";
import { mainStream, noteStream, generations } from "@/server/services/generation";
import { errorResponse, guardLocalRequest, readBody } from "@/server/http";
import { AppError } from "@/server/errors";
import { PROVIDER_KINDS } from "@/lib/types";
import { EFFORT_PATTERN } from "@/lib/chat-options";
import { NOTE_COLORS } from "@/lib/note-colors";
import { CONNECTOR_SIDES } from "@/lib/connector-types";
import { getCodexClient } from "@/server/providers/codex/client";
import { MAX_DOCUMENT_CHARACTERS } from "@/lib/document-import";
import { guardWorkspaceWrite, REVISION_HEADER, workspaceRevision } from "@/server/workspace-revision";
import { Backups, readBackupUpload } from "@/server/services/backups";
import { getBackupSchedule } from "@/server/backup-scheduler";
import { createHash } from "node:crypto";
import { manuscriptRoute } from "@/server/manuscript-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ path: string[] }> };
const chatInput = z.object({ ownerId: z.string().uuid(), text: z.string().trim().min(1).max(20_000), effort: z.string().regex(EFFORT_PATTERN).nullish(), webSearch: z.boolean().optional() });
const noteInput = z.object({
  conversationId: z.string().uuid(), parentMessageId: z.string().uuid(),
  selectedText: z.string().min(1).max(500).refine((v) => !!v.trim()),
  anchorStart: z.number().int().min(0), anchorEnd: z.number().int().min(1),
  anchorPrefix: z.string().max(50), anchorSuffix: z.string().max(50), anchorVersion: z.literal(1),
  x: z.number().int().min(0).max(100_000), y: z.number().int().min(0).max(1_000_000),
}).strict().refine((v) => v.anchorEnd - v.anchorStart === v.selectedText.length);
const connectorAttachment = z.object({ side: z.enum(CONNECTOR_SIDES), ratio: z.number().min(0).max(1) }).strict();
const layoutInput = z.object({
  x: z.number().int().min(0).max(100_000).optional(), y: z.number().int().min(0).max(1_000_000).optional(),
  width: z.number().int().min(240).max(2000).optional(), height: z.number().int().min(150).max(2000).optional(),
  collapsed: z.boolean().optional(), minimized: z.boolean().optional(), zIndex: z.number().int().min(1).max(1_000_000).optional(),
  connector: z.object({ source: connectorAttachment.extend({ segment: z.number().int().min(0).max(1000) }), target: connectorAttachment, bend: z.object({ x: z.number().min(-2000).max(2000), y: z.number().min(-2000).max(2000) }).strict() }).strict().nullable().optional(),
}).strict();
const settingsInput = z.object({
  defaultProvider: z.enum(PROVIDER_KINDS).optional(), codexDefaultModel: z.string().max(200).optional(),
  openaiModel: z.string().max(200).optional(), compatibleBaseUrl: z.url().refine((v) => /^https?:\/\//.test(v) && !new URL(v).username && !new URL(v).password, "Use an HTTP URL without credentials").optional(),
  compatibleModel: z.string().max(200).optional(),
}).strict();

async function dispatch(request: Request, context: RouteContext) {
  try {
    guardLocalRequest(request);
    const { path } = await context.params;
    const route = path.join("/");
    const method = request.method;
    guardWorkspaceWrite(request);
    const store = new Store(getDatabase());
    const manuscriptResponse = await manuscriptRoute(request, path, store);
    if (manuscriptResponse) return manuscriptResponse;
    if (route === "health" && method === "GET") return Response.json({ app: "fussenn", workspaceId: createHash("sha256").update(process.cwd().toLowerCase()).digest("hex"), processId: process.pid, ready: true, activeGenerations: generations.size });
    if (route === "workspace" && method === "GET") return Response.json({ revision: workspaceRevision() });
    if (path[0] === "backups") {
      const backups = new Backups(getDatabaseHandle().sqlite, dataDirectory(), () => generations.size > 0);
      const download = (bytes: Uint8Array, name: string) => new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      if (route === "backups" && method === "GET") return Response.json({ ...backups.status(), schedule: getBackupSchedule().status() });
      if (route === "backups/schedule" && method === "PATCH") {
        const input = await readBody(request, z.object({ enabled: z.boolean() }).strict());
        return Response.json(getBackupSchedule().configure(input.enabled));
      }
      if (route === "backups/scheduled" && method === "POST") return Response.json(getBackupSchedule().tick(true), { status: 201 });
      if (route === "backups/export" && method === "GET") return download(backups.export(), `Fussenn-${new Date().toISOString().replace(/[:.]/g, "-")}.fussenn.json`);
      if (path.length === 3 && path[1] === "automatic" && method === "GET") return download(backups.read(path[2]), path[2]);
      if (["backups/inspect", "backups/restore"].includes(route) && method === "POST") {
        const bytes = await readBackupUpload(request);
        guardWorkspaceWrite(request);
        if (route === "backups/inspect") return Response.json(backups.inspect(bytes));
        return Response.json(backups.restore(bytes, request.headers.get("X-Fussenn-Backup-Digest") ?? "", request.headers.get(REVISION_HEADER)!));
      }
    }
    if (route === "documents" && method === "POST") {
      const input = await readBody(request, z.object({ fileName: z.string().min(1).max(255), content: z.string().min(1).max(MAX_DOCUMENT_CHARACTERS) }).strict(), MAX_DOCUMENT_CHARACTERS * 6 + 4096);
      return Response.json(store.importDocument(input.fileName, input.content), { status: 201 });
    }
    if (path[0] === "documents" && path.length === 3 && path[2] === "provider" && method === "PATCH") {
      const input = await readBody(request, z.object({ providerKind: z.enum(PROVIDER_KINDS), model: z.string().trim().min(1).max(200) }).strict());
      const detail = store.detail(path[1]);
      if (detail.notes.some((note) => generations.has(`side_note:${note.id}`))) throw new AppError("付箋の回答が終わってからAIの設定を変更してください。", 409);
      if (input.providerKind === "mock" && !store.settings().mockEnabled) throw new AppError("Mock Providerは無効です。");
      return Response.json(store.updateDocumentProvider(path[1], input.providerKind, input.model));
    }
    if (route === "folders" && method === "GET") return Response.json(store.listFolders());
    if (route === "folders" && method === "POST") {
      const input = await readBody(request, z.object({ name: z.string().trim().min(1).max(60) }).strict());
      return Response.json(store.createFolder(input.name), { status: 201 });
    }
    if (path[0] === "folders" && path.length === 2) {
      if (method === "PATCH") {
        const input = await readBody(request, z.object({ name: z.string().trim().min(1).max(60) }).strict());
        return Response.json(store.renameFolder(path[1], input.name));
      }
      if (method === "DELETE") { store.deleteFolder(path[1]); return Response.json({ ok: true }); }
    }
    if (route === "conversations" && method === "GET") return Response.json(store.listConversations());
    if (route === "conversations" && method === "POST") {
      const input = await readBody(request, z.object({ providerKind: z.enum(PROVIDER_KINDS), model: z.string().trim().min(1).max(200) }).strict());
      if (input.providerKind === "mock" && !store.settings().mockEnabled) throw new AppError("Mock Providerは無効です。");
      return Response.json(store.createConversation(input.providerKind, input.model), { status: 201 });
    }
    if (path[0] === "conversations" && path.length === 2) {
      if (method === "GET") return Response.json(store.detail(path[1]));
      if (method === "PATCH") {
        const input = await readBody(request, z.object({ title: z.string().trim().min(1).max(100).optional(), folderId: z.string().uuid().nullable().optional() }).strict().refine((v) => v.title !== undefined || v.folderId !== undefined, "変更内容を指定してください。"));
        return Response.json(store.updateConversation(path[1], input));
      }
      if (method === "DELETE") {
        const detail = store.detail(path[1]);
        if (generations.has(`conversation:${path[1]}`) || detail.notes.some((n) => generations.has(`side_note:${n.id}`))) throw new AppError("回答の生成が終わってから削除してください。", 409);
        store.deleteConversation(path[1]);
        return Response.json({ ok: true });
      }
    }
    if (route === "chat/main" && method === "POST") {
      const { ownerId, text, effort, webSearch } = await readBody(request, chatInput);
      return mainStream(store, ownerId, text, undefined, { effort, webSearch });
    }
    if (route === "chat/note" && method === "POST") {
      const { ownerId, text, effort, webSearch } = await readBody(request, chatInput);
      return noteStream(store, ownerId, text, undefined, { effort, webSearch });
    }
    if (route === "notes" && method === "POST") {
      const { conversationId, parentMessageId, x, y, ...anchor } = await readBody(request, noteInput);
      return Response.json(store.createNote(conversationId, parentMessageId, anchor, { x, y }), { status: 201 });
    }
    if (path[0] === "notes" && path.length === 2) {
      if (method === "PATCH") return Response.json(store.updateNote(path[1], await readBody(request, z.object({ memo: z.string().max(20_000).optional(), mode: z.enum(["memo", "chat"]).optional(), color: z.enum(NOTE_COLORS).optional() }).strict())));
      if (method === "DELETE") {
        if (generations.has(`side_note:${path[1]}`)) throw new AppError("回答の生成が終わってから削除してください。", 409);
        store.deleteNote(path[1]); return Response.json({ ok: true });
      }
    }
    if (path[0] === "notes" && path[2] === "layout" && path.length === 3 && method === "PATCH") return Response.json(store.updateLayout(path[1], await readBody(request, layoutInput)));
    if (route === "settings" && method === "GET") return Response.json(store.settings());
    if (route === "settings" && method === "PATCH") {
      const input = await readBody(request, settingsInput);
      if (input.defaultProvider === "mock" && !store.settings().mockEnabled) throw new AppError("Mock Providerは無効です。");
      return Response.json(store.updateSettings(input));
    }
    if (route === "providers/codex/status" && method === "GET") {
      try { return Response.json(await getCodexClient().status()); }
      catch (error) { return Response.json({ installed: false, signedIn: false, authType: null, plan: null, error: error instanceof AppError ? error.message : "Codexの状態を確認できませんでした。" }); }
    }
    if (route === "providers/codex/models" && method === "GET") return Response.json(await getCodexClient().models());
    if (route === "providers/codex/login" && method === "POST") return Response.json(await getCodexClient().login());
    if (route === "providers/codex/login/device" && method === "POST") return Response.json(await getCodexClient().login(true));
    if (route === "providers/codex/logout" && method === "POST") { await getCodexClient().logout(); return Response.json({ ok: true }); }
    throw new AppError("APIが見つかりません。", 404);
  } catch (error) { return errorResponse(error); }
}
async function handle(request: Request, context: RouteContext) {
  const response = await dispatch(request, context);
  response.headers.set(REVISION_HEADER, workspaceRevision());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
