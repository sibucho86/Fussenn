import { z } from "zod";
import { readBody } from "./http";
import { Manuscripts } from "./services/manuscripts";
import type { Store } from "./services/store";
import { generations } from "./services/generation";
import { AppError } from "./errors";
const revision = z.number().int().min(1);
const offset = z.number().int().min(0).max(100_000);

export async function manuscriptRoute(request: Request, path: string[], store: Store): Promise<Response | null> {
  if (path[0] !== "manuscripts") return null;
  const service = new Manuscripts(store), method = request.method;
  if (path.length === 1 && method === "POST") {
    const title = z.string().trim().min(1).max(100);
    const input = await readBody(request, z.union([
      z.object({ title, sourceMessageId: z.string().uuid().optional() }).strict(),
      z.object({ title, file: z.object({ fileName: z.string().min(1).max(255), content: z.string().max(100_000) }).strict() }).strict(),
    ]), 610_000);
    return Response.json(service.create(input.title, "sourceMessageId" in input ? input.sourceMessageId : undefined, "file" in input ? input.file : undefined), { status: 201 });
  }
  if (path[1] === "notes" && path.length === 4 && method === "POST") {
    const id = z.uuid().parse(path[2]);
    if (path[3] === "draft") {
      const input = await readBody(request, z.object({ draft: z.string().max(20_000), expected: z.number().int().nonnegative() }).strict(), 130_000);
      return Response.json(service.draft(id, input.draft, input.expected));
    }
    if (path[3] === "apply") {
      const input = await readBody(request, z.object({ expected: revision, expectedDraft: z.number().int().nonnegative(), mode: z.enum(["replace", "before", "after"]) }).strict());
      return Response.json(service.apply(id, input.expected, input.expectedDraft, input.mode));
    }
    if (path[3] === "context") {
      const input = await readBody(request, z.object({ expected: revision }).strict());
      if (generations.has(`side_note:${id}`)) throw new AppError("回答が終わってから参照を更新してください。", 409);
      return Response.json(service.refreshContext(id, input.expected));
    }
    if (path[3] === "revise") {
      const input = await readBody(request, z.object({ expected: revision, expectedDraft: z.number().int().nonnegative() }).strict());
      if (generations.has(`side_note:${id}`)) throw new AppError("回答が終わってから推敲を再開してください。", 409);
      return Response.json(service.revise(id, input.expected, input.expectedDraft));
    }
  }
  if (path.length >= 2) {
    const id = z.uuid().parse(path[1]);
    if (path.length === 2 && method === "PATCH") {
      const input = await readBody(request, z.object({ content: z.string().max(100_000), expected: revision, label: z.string().trim().min(1).max(100).optional() }).strict(), 610_000);
      return Response.json(service.save(id, input.content, input.expected, input.label, input.label ? "checkpoint" : "edit"));
    }
    if (path.length === 3 && path[2] === "notes" && method === "POST") {
      const input = await readBody(request, z.object({ expected: revision, from: offset, to: offset, x: offset, y: z.number().int().min(0).max(1_000_000) }).strict());
      return Response.json(service.createNote(id, input.expected, input.from, input.to, input.x, input.y), { status: 201 });
    }
    if (path[2] === "history") {
      if (path.length === 3 && method === "GET") return Response.json(service.history(id));
      if (path.length === 4 && method === "GET") return Response.json(service.version(id, path[3]));
      if (path.length === 4 && method === "POST") {
        const input = await readBody(request, z.object({ expected: revision }).strict());
        return Response.json(service.restore(id, path[3], input.expected));
      }
    }
  }
  throw new AppError("原稿の操作が見つかりません。", 404);
}
