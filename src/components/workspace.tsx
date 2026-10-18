"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, ChevronDown, EyeOff, Feather, FileText, Settings2, ShieldCheck, Sparkles, Spline, StickyNote, X } from "lucide-react";
import type { Conversation, ConversationDetail, ConversationFolder, ProviderKind, PublicSettings } from "@/lib/types";
import { api } from "@/lib/api";
import { useChatStream, applyStreamEvent } from "@/hooks/use-chat-stream";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/messages";
import { NoteCanvas, type NoteCanvasHandle } from "@/components/sidenote/note-canvas";
import { NoteIndex } from "@/components/sidenote/note-index";
import { ConversationSidebar } from "@/components/conversations/sidebar";
import { ConversationExport } from "@/components/conversations/conversation-export";
import { ImportDialog } from "@/components/documents/import-dialog";
import { DocumentView } from "@/components/documents/document-view";
import { DocumentAISettings } from "@/components/documents/document-ai-settings";
import { ManuscriptWorkspace } from "@/components/manuscripts/workspace";
import { CreateManuscriptDialog } from "@/components/manuscripts/create-dialog";
import { flushDesktopSaves } from "@/lib/desktop";
import type { CodexModel } from "@/server/providers/codex/client";

export const providerLabels: Record<ProviderKind, string> = { codex: "Codex · ChatGPT", openai: "OpenAI API", "openai-compatible": "OpenAI Compatible", mock: "Mock · デモ" };
// The browser version keeps its origin across the rename from SideNote AI, so the previous key still applies.
const CONNECTOR_VISIBILITY_KEY = "fussenn:show-connectors", PREVIOUS_CONNECTOR_VISIBILITY_KEY = "sidenote:show-connectors";
export default function Workspace() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [folders, setFolders] = useState<ConversationFolder[]>([]);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [provider, setProvider] = useState<ProviderKind>("codex");
  const [model, setModel] = useState("");
  const [codexModels, setCodexModels] = useState<CodexModel[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [noteIndexOpen, setNoteIndexOpen] = useState(false);
  const [manuscriptStart, setManuscriptStart] = useState<{ title: string; sourceMessageId?: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [documentAISettingsOpen, setDocumentAISettingsOpen] = useState(false);
  const [showConnectors, setShowConnectors] = useState(true);
  const noteCanvas = useRef<NoteCanvasHandle>(null);
  const loadVersion = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const sendingMain = useRef(false);
  const stream = useChatStream();
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [s, rows, folderRows] = await Promise.all([api<PublicSettings>("settings"), api<Conversation[]>("conversations"), api<ConversationFolder[]>("folders")]);
        if (cancelled) return;
        try { setShowConnectors((localStorage.getItem(CONNECTOR_VISIBILITY_KEY) ?? localStorage.getItem(PREVIOUS_CONNECTOR_VISIBILITY_KEY)) !== "false"); } catch { /* Use visible lines when browser storage is unavailable. */ }
        setSettings(s); setConversations(rows); setFolders(folderRows); setProvider(s.defaultProvider); setModel(modelFor(s, s.defaultProvider));
        const id = new URLSearchParams(window.location.search).get("chat");
        if (id) {
          const conversation = await api<ConversationDetail>(`conversations/${id}`);
          if (!cancelled) { if (conversation.document) followBottom.current = false; setDetail(conversation); }
        }
      } catch (e) { if (!cancelled) setError(errorText(e)); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!settings || provider !== "codex" || detail) return;
    let cancelled = false;
    void api<CodexModel[]>("providers/codex/models").then((models) => {
      if (cancelled) return;
      setCodexModels(models);
      setModel((current) => current || (models.find((m) => m.isDefault) ?? models[0])?.model || "");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [provider, detail, settings]);
  useEffect(() => {
    if (!followBottom.current) return;
    const frame = requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      if (scroll) scroll.scrollTo({ top: scroll.scrollHeight, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [detail?.messages]);
  async function selectConversation(id: string) {
    if (!await saveBeforeLeaving()) return;
    setNoteIndexOpen(false);
    setDocumentAISettingsOpen(false);
    const version = ++loadVersion.current;
    setLoading(true); setError(""); stream.clearError(); followBottom.current = false;
    try {
      const data = await api<ConversationDetail>(`conversations/${id}`);
      if (version !== loadVersion.current) return;
      setDetail(data); window.history.replaceState(null, "", `/?chat=${id}`);
      scrollRef.current?.scrollTo({ top: 0 });
    } catch (e) { setError(errorText(e)); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }
  async function newChat(deleted = false) {
    if (!deleted && !await saveBeforeLeaving()) return;
    setNoteIndexOpen(false);
    setDocumentAISettingsOpen(false);
    ++loadVersion.current; setDetail(null); setError(""); setLoading(false); stream.clearError(); followBottom.current = true;
    if (settings) { setProvider(settings.defaultProvider); setModel(modelFor(settings, settings.defaultProvider)); }
    window.history.replaceState(null, "", "/");
  }
  function documentImported(row: ConversationDetail) {
    ++loadVersion.current; followBottom.current = false;
    setImportOpen(false); setNoteIndexOpen(false); setLoading(false); setError(""); stream.clearError();
    conversationSaved(row); setDetail(row); window.history.replaceState(null, "", `/?chat=${row.id}`);
    scrollRef.current?.scrollTo({ top: 0 });
  }
  function conversationSaved(row: Conversation) {
    setConversations((current) => [...current.filter((c) => c.id !== row.id), row].sort((a, b) => b.updatedAt - a.updatedAt));
    setDetail((current) => current?.id === row.id ? { ...current, title: row.title, titleEdited: row.titleEdited, folderId: row.folderId } : current);
  }
  function changeConnectorVisibility(visible: boolean) {
    if (!visible) noteCanvas.current?.closeConnectorEditor();
    setShowConnectors(visible);
    try { localStorage.setItem(CONNECTOR_VISIBILITY_KEY, String(visible)); } catch { /* Keep the toggle usable without storage. */ }
  }
  function conversationMoved(row: Pick<Conversation, "id" | "folderId" | "updatedAt">) {
    setConversations((current) => current.map((c) => c.id === row.id ? { ...c, folderId: row.folderId, updatedAt: Math.max(c.updatedAt, row.updatedAt) } : c).sort((a, b) => b.updatedAt - a.updatedAt));
    setDetail((current) => current?.id === row.id ? { ...current, folderId: row.folderId } : current);
  }
  async function refreshList() {
    const rows = await api<Conversation[]>("conversations");
    setConversations(rows);
    setDetail((current) => {
      const row = rows.find((c) => c.id === current?.id);
      return current && row ? { ...current, title: row.title, titleEdited: row.titleEdited, folderId: row.folderId } : current;
    });
  }
  async function sendMain(text: string) {
    if (detail?.document) return false;
    if (sendingMain.current) return false;
    sendingMain.current = true;
    setError(""); followBottom.current = true;
    try {
      let conversation = detail;
      if (!conversation) {
        if (!model.trim()) throw new Error("モデルを選択してください。設定画面からProviderを準備できます。");
        conversation = await api<ConversationDetail>("conversations", { method: "POST", body: JSON.stringify({ providerKind: provider, model }) });
        conversationSaved(conversation);
        setDetail(conversation); window.history.replaceState(null, "", `/?chat=${conversation.id}`);
      }
      const id = conversation.id;
      const success = await stream.send("main", id, text, (event) => {
        const autoTitle = Array.from(text.replace(/\s+/g, " ")).slice(0, 50).join("");
        setDetail((current) => current?.id === id ? { ...current, messages: applyStreamEvent(current.messages, event), title: current.messages.length === 0 && !current.titleEdited ? autoTitle : current.title } : current);
        if (event.type === "started" && conversation.messages.length === 0) setConversations((rows) => rows.map((c) => c.id === id && !c.titleEdited ? { ...c, title: autoTitle } : c));
      });
      await refreshList();
      return success;
    } catch (e) { setError(errorText(e)); return false; }
    finally { sendingMain.current = false; }
  }
  async function saveBeforeLeaving() {
    if (await flushDesktopSaves()) return true;
    setError("編集中の内容を保存できませんでした。未保存の表示を確認して再試行してください。"); return false;
  }
  async function beginManuscript(sourceMessageId?: string) {
    if (!await saveBeforeLeaving()) return;
    setManuscriptStart({ title: sourceMessageId ? (detail?.title ?? "新しい原稿").slice(0, 94) + "（原稿）" : "新しい原稿", sourceMessageId });
  }
  useEffect(() => {
    if (!detail?.document?.editable) return;
    const leave = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.origin !== location.origin || link.pathname !== "/settings") return;
      event.preventDefault(); event.stopPropagation();
      void flushDesktopSaves().then((ok) => { if (ok) window.location.assign(link.href); else setError("原稿を保存できませんでした。保存を再試行してください。"); });
    };
    document.addEventListener("click", leave, true);
    return () => document.removeEventListener("click", leave, true);
  }, [detail?.document?.editable]);
  const activeProvider = detail?.providerKind ?? provider;
  return <div className="app-shell">
    <ConversationSidebar conversations={conversations} folders={folders} activeId={detail?.id} onNewChat={() => void newChat()} onNewManuscript={() => void beginManuscript()} onImport={() => { void saveBeforeLeaving().then((ok) => { if (ok) setImportOpen(true); }); }} onSelect={(id) => void selectConversation(id)} onConversationSaved={conversationSaved} onConversationMoved={conversationMoved}
      onConversationDeleted={(id) => { setConversations((rows) => rows.filter((c) => c.id !== id)); if (detail?.id === id) void newChat(true); }}
      onFolderSaved={(row) => setFolders((rows) => rows.some((f) => f.id === row.id) ? rows.map((f) => f.id === row.id ? row : f) : [...rows, row])}
      onFolderDeleted={(id) => { setFolders((rows) => rows.filter((f) => f.id !== id)); setConversations((rows) => rows.map((c) => c.folderId === id ? { ...c, folderId: null } : c)); setDetail((current) => current?.folderId === id ? { ...current, folderId: null } : current); }} />
    <main className="main-workspace">
      <header className="workspace-header"><div><span className="header-crumb">{detail?.document?.editable ? "原稿" : detail?.document ? "DOCUMENT" : "WORKSPACE"}</span><span className="crumb-divider">/</span><span>{detail?.title ?? "新しい会話"}</span></div>
        <div className="header-right"><span className="provider-pill"><span className="status-dot" />{providerLabels[activeProvider]}</span><button className="connector-visibility" aria-label={showConnectors ? "引き出し線をまとめて隠す" : "引き出し線をまとめて表示"} aria-pressed={showConnectors} aria-controls="note-connector-layer" title={showConnectors ? "すべての付箋の引き出し線を隠す" : "すべての付箋の引き出し線を表示"} disabled={loading} onClick={() => changeConnectorVisibility(!showConnectors)}>{showConnectors ? <Spline size={14} /> : <EyeOff size={14} />}引き出し線 <span>{showConnectors ? "表示" : "非表示"}</span></button><button className="note-count" aria-label="付箋一覧を開く" aria-haspopup="dialog" aria-expanded={noteIndexOpen} aria-controls="conversation-note-index" disabled={loading} onClick={() => setNoteIndexOpen(true)}><StickyNote size={14} />付箋一覧 <span>{detail?.notes.length ?? 0}</span></button><ConversationExport conversation={detail} folderName={folders.find((folder) => folder.id === detail?.folderId)?.name ?? null} disabled={loading} /></div>
      </header>
      {(error || stream.error) && <div className="error-banner" role="alert">{error || stream.error}<button className="icon-button" aria-label="エラーを閉じる" onClick={() => { setError(""); stream.clearError(); }}><X size={14} /></button></div>}
      <div className="canvas-scroll" ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; }}>
        {detail?.document?.editable && !loading ? <ManuscriptWorkspace key={detail.id} detail={detail} canvasRef={noteCanvas} showConnectors={showConnectors} onShowConnectors={() => changeConnectorVisibility(true)} onDetail={(update) => setDetail((current) => current?.id === detail.id ? update(current) : current)} onNotes={(update) => setDetail((current) => current?.id === detail.id ? { ...current, notes: update(current.notes) } : current)} onError={setError} /> : <NoteCanvas ref={noteCanvas} key={detail?.id ?? "new"} detail={detail} showConnectors={showConnectors} onShowConnectors={() => changeConnectorVisibility(true)} onNotes={(update) => setDetail((current) => current ? { ...current, notes: update(current.notes) } : current)} onError={setError}>
          {loading ? <div className="loading-state">ノートを開いています…</div> : detail?.document ? <DocumentView detail={detail} onEdit={() => void beginManuscript(detail.document!.messageId)} /> : !detail?.messages.length ? <div className="welcome">
            <span className="welcome-symbol"><Feather size={29} strokeWidth={1.2} /></span>
            <span className="eyebrow">A LITTLE SPACE FOR CURIOSITY</span>
            <h1>理解を、余白に。</h1><p className="welcome-description">話を広げず、理解を深める。<br />AIの回答に付箋を貼って、気になることをその場で聞こう。</p>
            <div className="welcome-demo" aria-hidden="true"><div className="demo-page"><span className="demo-caption">AIとの会話</span><div className="demo-line" /><p>AIと外部のデータをつなぐ<br />その中で <mark>Resource</mark> は…</p><div className="demo-line short" /></div><svg className="demo-connector" viewBox="0 0 100 70"><path d="M5 5 C80 5 20 60 90 60" /></svg><div className="demo-note"><span><StickyNote size={13} />Resource</span><p>これって何？</p><span className="demo-note-answer"><Sparkles size={12} />この文脈で、もう少し。</span></div></div>
            <div className="starter-grid"><button onClick={() => void sendMain("MCPについて、全体像から教えて") } disabled={stream.busy}><BookOpen size={17} /><span>新しいことを学ぶ<small>MCPについて、全体像から教えて</small></span><ArrowUpRight size={15} /></button><button onClick={() => void sendMain("AIの仕組みを、身近な例で説明して") } disabled={stream.busy}><Sparkles size={17} /><span>仕組みをひもとく<small>AIの仕組みを、身近な例で</small></span><ArrowUpRight size={15} /></button></div>
            <button className="welcome-import" onClick={() => setImportOpen(true)}><FileText size={15} />手元のMarkdown・テキスト・PDFを開く</button>
          </div> : <div className="main-column"><div className="conversation-topline"><span className="eyebrow">A CONVERSATION, WITH ROOM TO THINK</span><span className="date-label">{new Date(detail.createdAt).toLocaleDateString("ja-JP", { month: "long", day: "numeric" })}</span></div><MessageList messages={detail.messages} onEdit={(id) => void beginManuscript(id)} /><div className="selection-tip"><StickyNote size={13} />回答の気になる言葉を選択して、付箋を貼れます。</div></div>}
        </NoteCanvas>}
      </div>
      {detail?.document ? <footer className="document-dock"><div><FileText size={16} /><span>{detail.document.editable ? "付箋で文章を練り、「原稿案」から本文へ反映できます。" : "本文を選んで「＋付箋」から、メモやAIへの質問を残せます。"}<small>{detail.model ? `付箋AI：${providerLabels[detail.providerKind]} · ${detail.model}` : "AIは未設定です。メモだけでも使えます。"}</small></span></div><button className="secondary-button" disabled={!settings || loading} onClick={() => setDocumentAISettingsOpen(true)}><Settings2 size={13} /> 付箋AIの設定</button></footer> : <footer className="composer-dock">
        {!detail && settings && <div className="provider-controls"><label><span>Provider</span><select aria-label="Provider" value={provider} onChange={(e) => { const p = e.target.value as ProviderKind; setProvider(p); setModel(modelFor(settings, p)); }}>{Object.entries(providerLabels).filter(([p]) => p !== "mock" || settings.mockEnabled).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={12} /></label><label><span>Model</span>{provider === "codex" ? <select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}><option value="">モデルを選択</option>{model && !codexModels.some((m) => m.model === model) && <option value={model}>{model}</option>}{codexModels.map((m) => <option key={m.id} value={m.model}>{m.displayName}</option>)}</select> : <input aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="モデル名" disabled={provider === "mock"} />}</label></div>}
        <Composer key={detail?.id ?? "new"} onSend={sendMain} busy={stream.busy || loading} />
        <div className="composer-caption"><span><ShieldCheck size={12} />会話と付箋は、このPCだけに保存されます。</span><span>理解するための、小さな余白。</span></div>
      </footer>}
    </main>{noteIndexOpen && <NoteIndex key={detail?.id ?? "new"} notes={detail?.notes ?? []} title={detail?.title ?? "新しい会話"} isDocument={!!detail?.document} onClose={() => setNoteIndexOpen(false)} onReveal={async (id) => { followBottom.current = false; return await noteCanvas.current?.revealNote(id) ?? false; }} />}
    {manuscriptStart && <CreateManuscriptDialog initialTitle={manuscriptStart.title} sourceMessageId={manuscriptStart.sourceMessageId} onClose={() => setManuscriptStart(null)} onCreated={(row) => { setManuscriptStart(null); documentImported(row); }} />}
    {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImported={documentImported} />}
    {documentAISettingsOpen && detail?.document && settings && <DocumentAISettings key={detail.id} detail={detail} settings={settings} onClose={() => setDocumentAISettingsOpen(false)} onSaved={(row) => {
      setDocumentAISettingsOpen(false); conversationSaved(row);
      // Keep local memo drafts, note layout and any just-finished stream instead of replacing the canvas.
      setDetail((current) => current?.id === row.id ? { ...current, providerKind: row.providerKind, model: row.model, notes: current.notes.map((note) => ({ ...note, providerSessionId: null })) } : current);
    }} />}
    <div className="desktop-hint">Fussennはデスクトップ向けです。画面幅1024px以上でお使いください。</div>
  </div>;
}
function modelFor(settings: PublicSettings, provider: ProviderKind) {
  return provider === "mock" ? "mock-demo" : provider === "codex" ? settings.codexDefaultModel : provider === "openai" ? settings.openaiModel : settings.compatibleModel;
}
function errorText(e: unknown) { return e instanceof Error ? e.message : "通信に失敗しました。"; }
