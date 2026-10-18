import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { generations, mainStream } from "@/server/services/generation";
import { CodexAppServerClient } from "@/server/providers/codex/client";
import { CodexProvider } from "@/server/providers/codex";

let client: CodexAppServerClient, db: ReturnType<typeof openDatabase>, store: Store, id: string, provider: CodexProvider;
beforeEach(() => {
  db = openDatabase(":memory:"); store = new Store(db.db); id = store.createConversation("codex", "fixture-model").id;
  client = new CodexAppServerClient({ command: process.execPath, args: [resolve("tests/fixtures/codex-app-server.mjs")], workspace: mkdtempSync(join(tmpdir(), "fussenn-recovery-")) });
  provider = new CodexProvider(client);
});
afterEach(() => { client.dispose(); db.sqlite.close(); });

it("saves a disconnected response, releases the lock and reconnects on the next question", async () => {
  await client.request("test/behavior", { behavior: "disconnect" });
  expect(await mainStream(store, id, "before disconnect", provider).text()).toContain('"type":"error"');
  expect(store.detail(id).messages[1]).toMatchObject({ content: "saved partial answer", status: "error" });
  expect(generations.size).toBe(0);
  expect(await mainStream(store, id, "after reconnect", provider).text()).toContain('"type":"completed"');
  expect(store.detail(id).messages).toHaveLength(4);
});

it("preserves data after simulated credential expiry and resumes after login without exposing upstream errors", async () => {
  await client.request("test/behavior", { behavior: "expired" });
  const output = await mainStream(store, id, "expiry", provider).text();
  expect(output).toContain("認証状態"); expect(output).not.toContain("fixture authentication expired");
  expect(store.detail(id).messages[1]).toMatchObject({ status: "error", content: "saved partial answer" });
  expect((await client.status()).signedIn).toBe(false);
  expect(await mainStream(store, id, "while signed out", provider).text()).toContain("サインインが必要");
  const before = store.detail(id);
  await client.login();
  expect(store.detail(id)).toEqual(before);
  expect(await mainStream(store, id, "after login", provider).text()).toContain('"type":"completed"');
  expect(generations.size).toBe(0);
});

it("allows provider retries to complete and cleans up a cancelled stream before another question", async () => {
  await client.request("test/behavior", { behavior: "retry" });
  const retry = await mainStream(store, id, "retrying upstream", provider).text();
  expect(retry).not.toContain('"type":"error"');
  expect(store.detail(id).messages[1]).toMatchObject({ status: "complete", content: "saved partial answer recovered" });
  await client.request("test/behavior", { behavior: "hang" });
  const reader = mainStream(store, id, "cancel", provider).body!.getReader();
  await reader.read(); await reader.read(); await reader.cancel();
  await expect.poll(() => generations.size).toBe(0);
  expect(store.detail(id).messages[3]).toMatchObject({ status: "error", content: "saved partial answer" });
  expect(await mainStream(store, id, "next", provider).text()).toContain('"type":"completed"');
});
