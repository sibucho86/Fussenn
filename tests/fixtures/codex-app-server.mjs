import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
const write = (value) => process.stdout.write(JSON.stringify(value) + "\n");
let initialized = false;
let notificationReceived = false;
let threadCounter = 0;
let turnCounter = 0;
let lastInput = null;
let lastOptions = null;
let signedIn = true;
let nextBehavior = "normal";
let failModels = false;
let ignoreInterrupt = false;
const resumed = [];
const approvalResults = [];
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (!message.method) { approvalResults.push(message); return; }
  const { id, method, params } = message;
  if (method === "initialize") { initialized = true; write({ id, result: { userAgent: "fixture" } }); return; }
  if (method === "initialized") { notificationReceived = true; return; }
  if (!initialized || !notificationReceived) { write({ id, error: { code: -1, message: "Missing handshake" } }); return; }
  if (method === "config/read") write({ id, result: { config: { mcp_servers: { inherited_server: { enabled: true } }, plugins: {} } } });
  else if (method === "account/read") write({ id, result: { account: signedIn ? { type: "chatgpt", email: "do-not-expose@example.test", planType: "test" } : null } });
  else if (method === "model/list" && failModels) write({ id, error: { code: -1, message: "Model list unavailable" } });
  else if (method === "model/list") write({ id, result: { data: [{ id: "m1", model: "fixture-model", displayName: "Fixture", isDefault: true, hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }, { reasoningEffort: "medium", description: "Balanced" }, { reasoningEffort: "high", description: "Deep" }, { reasoningEffort: "Not An Effort!", description: "Invalid" }], defaultReasoningEffort: "medium" }], nextCursor: null } });
  else if (method === "account/login/start") {
    signedIn = true;
    write({ id, result: params.type === "chatgptDeviceCode" ? { type: "chatgptDeviceCode", loginId: "device1", verificationUrl: "https://example.test/device", userCode: "ABCD-1234" } : { type: "chatgpt", loginId: "login1", authUrl: "https://example.test/auth" } });
    write({ method: "account/login/completed", params: { success: true } });
  } else if (method === "account/logout") { signedIn = false; write({ id, result: {} }); }
  else if (method === "thread/start") { lastOptions = params; write({ id, result: { thread: { id: `thread-${++threadCounter}` } } }); }
  else if (method === "thread/resume") {
    resumed.push(params.threadId);
    if (params.threadId === "missing") write({ id, error: { code: -1, message: "Thread missing" } });
    else write({ id, result: { thread: { id: params.threadId } } });
  } else if (method === "turn/start") {
    const turnId = `turn-${++turnCounter}`;
    lastInput = params;
    const behavior = nextBehavior; nextBehavior = "normal";
    if (behavior === "stale") {
      // A late notice from an earlier, stopped turn arrives before this turn is acknowledged.
      write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: "turn-earlier", status: "interrupted" } } });
      write({ method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId: "turn-earlier", itemId: "old", delta: "stale text " } });
    }
    if (behavior === "web") {
      // A search whose query is known only at completion, and a progress note that must not become part of the answer.
      write({ id, result: { turn: { id: turnId } } });
      const item = (method, item) => write({ method, params: { threadId: params.threadId, turnId, item } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      item("item/started", { type: "agentMessage", id: "note1", text: "", phase: "commentary" });
      write({ method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId, itemId: "note1", delta: "最新の情報を確認します。" } });
      item("item/completed", { type: "agentMessage", id: "note1", text: "最新の情報を確認します。", phase: "commentary" });
      item("item/started", { type: "webSearch", id: "ws1", query: "", action: null });
      item("item/completed", { type: "webSearch", id: "ws1", query: "fixture   release\nnotes", action: { type: "search", query: "fixture release notes", queries: null } });
      item("item/started", { type: "webSearch", id: "ws2", query: "", action: { type: "openPage", url: "https://docs.example.test/page" } });
      item("item/started", { type: "reasoning", id: "r1", summary: [], content: [] });
      write({ method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId, itemId: "final", delta: "Searched answer" } });
      write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      return;
    }
    if (behavior !== "normal" && behavior !== "stale") {
      write({ id, result: { turn: { id: turnId } } });
      write({ method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId, itemId: "partial-item", delta: "saved partial answer" } });
      if (behavior === "disconnect") { setTimeout(() => process.exit(1), 10); return; }
      if (behavior === "hang") return;
      if (behavior === "expired") {
        signedIn = false;
        write({ method: "error", params: { threadId: params.threadId, turnId, willRetry: false, error: { message: "fixture authentication expired" } } });
        return;
      }
      if (behavior === "retry") {
        write({ method: "error", params: { threadId: params.threadId, turnId, willRetry: true } });
        write({ method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId, itemId: "partial-item", delta: " recovered" } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
        return;
      }
    }
    // Deliberately notify before acknowledging turn/start.
    write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
    write({ method: "item/started", params: { threadId: params.threadId, turnId, item: { type: "reasoning", id: "r0", summary: [], content: [] } } });
    write({ method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId, itemId: "item1", delta: "Resource " } });
    write({ method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId, itemId: "item1", delta: "explained" } });
    write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
    write({ id, result: { turn: { id: turnId } } });
  } else if (method === "test/behavior") { nextBehavior = params.behavior; write({ id, result: {} }); }
  else if (method === "test/inspect") write({ id, result: { lastInput, lastOptions, approvalResults, resumed } });
  else if (method === "test/failModels") { failModels = true; write({ id, result: {} }); }
  else if (method === "test/approvals") {
    write({ id: "approval1", method: "item/commandExecution/requestApproval", params: {} });
    write({ id: "approval2", method: "item/fileChange/requestApproval", params: {} });
    write({ id: "unknown", method: "unrecognized/tool", params: {} });
    write({ id, result: {} });
  } else if (method === "test/crash") process.exit(1);
  else if (method === "turn/interrupt") {
    write({ id, result: {} });
    if (!ignoreInterrupt) write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
  }
  else if (method === "test/ignoreInterrupt") { ignoreInterrupt = true; write({ id, result: {} }); }
  else write({ id, error: { code: -32601, message: "Unknown method" } });
});
