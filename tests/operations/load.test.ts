import { expect, it } from "vitest";
import { chromium, expect as browserExpect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { Backups } from "@/server/services/backups";
import { decodeBackup, digest } from "@/server/services/backup-format";
import { workspaceRevision } from "@/server/workspace-revision";
import { windowsScript } from "./windows";

it.skipIf(process.platform !== "win32")("exercises a large workspace for ten minutes with repeated editing, navigation, backups and a data-preserving restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fussenn-load-")), port = 3260, base = `http://127.0.0.1:${port}`;
  const db = openDatabase(join(directory, "fussenn.db")), store = new Store(db.db);
  const documents: { id: string; notes: string[] }[] = [];
  const source = Array.from({ length: 100 }, (_, i) => `KEY-${String(i).padStart(3, "0")}: 荷重、疲労限度、安全率について検討した内容を記録します。`).join("\n");
  const seedStart = performance.now();
  db.db.transaction(() => {
    store.updateSettings({ defaultProvider: "mock" });
    for (let i = 0; i < 200; i++) {
      const chat = store.createConversation("mock", "mock-demo");
      for (let turn = 0; turn < 3; turn++) {
        const pair = store.beginMain(chat.id, `会話 ${i} 質問 ${turn}`);
        store.finishMain(chat.id, pair.assistantMessage.id, "Resource は参照する情報です。\n".repeat(40), "complete");
        if (turn === 2) {
          const note = store.createNote(chat.id, pair.assistantMessage.id, { selectedText: "Resource", anchorStart: 0, anchorEnd: 8, anchorPrefix: "", anchorSuffix: " は参照", anchorVersion: 1 }, { x: 800, y: 50 });
          const side = store.beginNote(note.id, "補足してください"); store.finishNote(note.id, side.assistantMessage.id, "補足の説明です。", "complete");
        }
      }
    }
    for (let i = 0; i < 101; i++) {
      const document = store.importDocument(`大量資料_${String(i).padStart(3, "0")}.txt`, source);
      const notes: string[] = [];
      for (let n = 0; n < (i === 100 ? 100 : 10); n++) {
        const selectedText = `KEY-${String(n).padStart(3, "0")}`, offset = source.indexOf(selectedText);
        const note = store.createNote(document.id, document.document!.messageId, { selectedText, anchorStart: offset, anchorEnd: offset + selectedText.length, anchorPrefix: source.slice(Math.max(0, offset - 15), offset), anchorSuffix: source.slice(offset + selectedText.length, offset + selectedText.length + 15), anchorVersion: 1 }, { x: 850, y: 50 + n * 65 });
        store.updateNote(note.id, { memo: `検討メモ ${n}`, color: n % 2 ? "blue" : "yellow" });
        store.updateLayout(note.id, { collapsed: true }); notes.push(note.id);
      }
      documents.push({ id: document.id, notes });
    }
  });
  const service = new Backups(db.sqlite, directory);
  const exportStart = performance.now(), initial = service.export(), exportMs = performance.now() - exportStart;
  const original = decodeBackup(initial).data;
  const restoreStart = performance.now(); service.restore(initial, digest(initial), workspaceRevision(db.sqlite));
  const restoreMs = performance.now() - restoreStart;
  expect(decodeBackup(service.export()).data).toEqual(original);
  const counts = service.status().counts;
  expect(counts).toMatchObject({ conversations: 200, documents: 101, notes: 1300 });
  db.sqlite.close();
  const report: Record<string, unknown> = { directory, counts, backupBytes: initial.length, seedAndRoundtripMs: performance.now() - seedStart, exportMs, restoreMs };
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/api/providers/codex/status", (route) => route.fulfill({ json: { installed: false, signedIn: false, authType: null, plan: null } }));
  const hot = documents[100], small = documents[0];
  const apiTimes: number[] = [], uiTimes: number[] = [];
  try {
    const launch = await windowsScript("Launch-Fussenn", port, directory);
    expect(launch, launch.output).toMatchObject({ code: 0 });
    const loadStart = performance.now(); await page.goto(`${base}/?chat=${hot.id}`);
    await browserExpect(page.getByTestId("floating-note")).toHaveCount(100, { timeout: 30_000 });
    report.initialLoadMs = performance.now() - loadStart;
    await expect.poll(async () => (await (await fetch(`${base}/api/backups`)).json()).schedule.lastSuccessAt, { timeout: 15_000 }).not.toBeNull();
    const cdp = await context.newCDPSession(page);
    const heap = async () => { await cdp.send("HeapProfiler.collectGarbage"); return (await cdp.send("Runtime.getHeapUsage")).usedSize; };
    const duration = Math.max(10_000, Number(process.env.FUSSENN_SOAK_MS) || 600_000);
    const began = performance.now(); let cycles = 0, baselineHeap = 0;
    while (performance.now() - began < duration) {
      const started = performance.now(), target = cycles % 2 ? hot : small;
      await page.locator(`[data-conversation-id="${target.id}"] .conversation-link`).click();
      await browserExpect(page.getByTestId("floating-note")).toHaveCount(target.notes.length);
      await page.getByRole("button", { name: "付箋一覧を開く", exact: true }).click();
      const index = page.getByRole("dialog", { name: /^この資料の付箋/ });
      await index.getByLabel("付箋を検索", { exact: true }).fill("KEY-000");
      await browserExpect(index.getByTestId("note-index-item")).toHaveCount(1);
      await index.getByTestId("note-index-item").click();
      // The list closes once the note is open, and focus then moves to the note. Typing earlier
      // reaches the inert page behind the list, or loses the caret to that focus change.
      await browserExpect(index).toBeHidden();
      const note = page.locator(`section[data-note-id="${target.notes[0]}"]`);
      await browserExpect(note).toBeFocused();
      const saved = page.waitForResponse((response) => response.url().endsWith(`/api/notes/${target.notes[0]}`) && response.request().method() === "PATCH");
      await note.getByLabel("付箋のメモ", { exact: true }).fill(`連続利用の保存確認 ${cycles}`);
      expect((await saved).ok()).toBe(true);
      uiTimes.push(performance.now() - started);
      const apiStart = performance.now();
      const data = await (await fetch(`${base}/api/conversations/${target.id}`)).json();
      apiTimes.push(performance.now() - apiStart);
      expect(data.notes.find((n: { id: string }) => n.id === target.notes[0]).memo).toBe(`連続利用の保存確認 ${cycles}`);
      cycles++;
      if (cycles === 6) baselineHeap = await heap();
      if (cycles % 30 === 0) process.stdout.write(`Fussenn soak: ${cycles} cycles, ${Math.round((performance.now() - began) / 1000)} seconds\n`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
    const finalHeap = await heap();
    // Same rule as docsImage(): refresh the published image only when explicitly requested.
    await page.screenshot({ path: process.env.FUSSENN_UPDATE_DOCS_IMAGES === "1" ? "docs/large-workspace.png" : join(directory, "large-workspace.png") });
    const snapshot = await (await fetch(`${base}/api/backups/export`)).json();
    expect(snapshot.data.side_notes).toHaveLength(1300);
    expect((await windowsScript("Stop-Fussenn", port, directory)).code).toBe(0);
    expect((await windowsScript("Launch-Fussenn", port, directory)).code).toBe(0);
    expect((await (await fetch(`${base}/api/backups/export`)).json()).data).toEqual(snapshot.data);
    const percentile = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
    Object.assign(report, { durationSeconds: (performance.now() - began) / 1000, cycles, initialHeapBytes: baselineHeap, finalHeapBytes: finalHeap, apiP95Ms: percentile(apiTimes), interactionP95Ms: percentile(uiTimes), pageErrors: errors, restartPreserved: true });
    expect(errors).toEqual([]);
    if (baselineHeap) expect(finalHeap).toBeLessThan(baselineHeap * 1.7 + 25 * 1024 * 1024);
    expect(percentile(apiTimes)).toBeLessThan(2000);
    expect(percentile(uiTimes)).toBeLessThan(10_000);
  } finally {
    await browser.close(); await windowsScript("Stop-Fussenn", port, directory);
    mkdirSync(resolve(".tmp"), { recursive: true }); writeFileSync(resolve(".tmp/operations-report.json"), JSON.stringify(report, null, 2));
  }
});
