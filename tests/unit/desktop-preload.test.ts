import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

type Save = () => Promise<boolean>;
// Runs the real preload with a stand-in for Electron's renderer modules.
function preload() {
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => Promise<void>>();
  const sent: unknown[][] = [];
  let api: { onBeforeClose: (save: Save) => () => void } | undefined;
  const electron = {
    contextBridge: { exposeInMainWorld: (_key: string, value: typeof api) => { api = value; } },
    ipcRenderer: { on: (channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<void>) => listeners.set(channel, listener), send: (...args: unknown[]) => sent.push(args), invoke: async () => undefined },
  };
  runInNewContext(readFileSync("desktop/preload.cjs", "utf8"), { require: (name: string) => { if (name !== "electron") throw new Error(name); return electron; } });
  const close = async (id: string) => { await listeners.get("fussenn:save")!({}, id); return sent.at(-1); };
  return { api: api!, close };
}

it("answers a close request at once before the page has registered its save handler", async () => {
  expect(await preload().close("early")).toEqual(["fussenn:saved", "early", true]);
});

it("waits for every registered save, reports any failure and stops asking after unregistering", async () => {
  const { api, close } = preload();
  const off = api.onBeforeClose(async () => false);
  expect(await close("failed")).toEqual(["fussenn:saved", "failed", false]);
  off();
  expect(await close("after")).toEqual(["fussenn:saved", "after", true]);
  const offThrowing = api.onBeforeClose(async () => { throw new Error("save failed"); });
  expect(await close("thrown")).toEqual(["fussenn:saved", "thrown", false]);
  offThrowing();
  api.onBeforeClose(async () => true);
  const offFailing = api.onBeforeClose(async () => false);
  expect(await close("one of two failed")).toEqual(["fussenn:saved", "one of two failed", false]);
  offFailing();
  api.onBeforeClose(async () => true);
  expect(await close("both saved")).toEqual(["fussenn:saved", "both saved", true]);
});
