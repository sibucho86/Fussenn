import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { openDatabase } from "@/server/db";
import { guardWorkspaceWrite, REVISION_HEADER, workspaceRevision } from "@/server/workspace-revision";
import { readBody } from "@/server/http";

const state = vi.hoisted(() => ({ handle: null as ReturnType<typeof openDatabase> | null }));
vi.mock("@/server/db", async (original) => ({ ...await original<typeof import("@/server/db")>(), getDatabaseHandle: () => state.handle! }));
beforeEach(() => { state.handle = openDatabase(":memory:"); });
afterEach(() => state.handle!.sqlite.close());

it("requires the current persistent revision for writes while allowing reads", () => {
  const revision = workspaceRevision();
  for (const method of ["POST", "PATCH", "DELETE"]) {
    expect(() => guardWorkspaceWrite(new Request("http://localhost/api/settings", { method }))).toThrow("再読み込み");
    expect(() => guardWorkspaceWrite(new Request("http://localhost/api/settings", { method, headers: { [REVISION_HEADER]: "old" } }))).toThrow("再読み込み");
    expect(() => guardWorkspaceWrite(new Request("http://localhost/api/settings", { method, headers: { [REVISION_HEADER]: revision } }))).not.toThrow();
  }
  expect(() => guardWorkspaceWrite(new Request("http://localhost/api/settings"))).not.toThrow();
});

it("rejects a write whose body finishes arriving after a restore", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const request = new Request("http://localhost/api/settings", { method: "PATCH", headers: { [REVISION_HEADER]: workspaceRevision() }, body, duplex: "half" } as RequestInit);
  guardWorkspaceWrite(request);
  const pending = readBody(request, z.object({ openaiModel: z.string() }));
  state.handle!.sqlite.prepare("UPDATE workspace_metadata SET revision = ? WHERE id = 1").run("restored");
  controller.enqueue(new TextEncoder().encode('{"openaiModel":"stale-draft"}')); controller.close();
  await expect(pending).rejects.toThrow("再読み込み");
});
