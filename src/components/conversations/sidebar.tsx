"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, FolderPlus, Inbox, LoaderCircle, MessageSquare, MoreHorizontal, Plus, Settings2, Trash2, X } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import type { Conversation, ConversationFolder } from "@/lib/types";
import { api } from "@/lib/api";

type Editor = { kind: "conversation"; row: Conversation } | { kind: "folder"; row: ConversationFolder } | { kind: "new-folder" };
const CONVERSATION_DRAG = "application/x-fussenn-conversation";
const folderKey = (id: string | null) => id ?? "unfiled";
type Move = { id: string; folderId: string | null; title: string; folderName: string };
type Props = {
  conversations: Conversation[]; folders: ConversationFolder[]; activeId?: string;
  onNewChat: () => void; onNewManuscript: () => void; onImport: () => void; onSelect: (id: string) => void;
  onConversationSaved: (row: Conversation) => void; onConversationDeleted: (id: string) => void;
  onConversationMoved: (row: Pick<Conversation, "id" | "folderId" | "updatedAt">) => void;
  onFolderSaved: (row: ConversationFolder) => void; onFolderDeleted: (id: string) => void;
};

export function ConversationSidebar(props: Props) {
  const { conversations, folders, activeId, onNewChat, onSelect } = props;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [failedMove, setFailedMove] = useState<Move | null>(null);
  const dragId = useRef<string | null>(null);
  const busy = useRef(false);
  const draggedGesture = useRef(false);
  const draggedConversation = conversations.find((c) => c.id === dragging);
  function endDrag() { dragId.current = null; setDragging(null); setHoveredFolder(null); }
  async function moveConversation(move: Move) {
    if (busy.current) return;
    const source = conversations.find((c) => c.id === move.id);
    if (!source || source.folderId === move.folderId) return;
    busy.current = true; setMoving(move.id); setFailedMove(null); setNotice("会話を移動しています…");
    try {
      const row = await api<Conversation>(`conversations/${move.id}`, { method: "PATCH", body: JSON.stringify({ folderId: move.folderId }) });
      props.onConversationMoved(row);
      if (row.folderId) setCollapsed((current) => { const next = new Set(current); next.delete(row.folderId!); return next; });
      setNotice(`「${source.title}」を「${move.folderName}」に移動しました。`);
    } catch { setNotice(""); setFailedMove(move); }
    finally { busy.current = false; setMoving(null); }
  }
  function accepts(event: React.DragEvent<HTMLElement>, folderId: string | null) {
    if (busy.current || !dragId.current || !event.dataTransfer.types.includes(CONVERSATION_DRAG)) return false;
    const source = conversations.find((c) => c.id === dragId.current);
    return !!source && source.folderId !== folderId;
  }
  function dragOver(event: React.DragEvent<HTMLElement>, folderId: string | null) {
    if (!accepts(event, folderId)) { if (dragId.current) event.dataTransfer.dropEffect = "none"; return; }
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    setHoveredFolder(folderKey(folderId));
  }
  function dragLeave(event: React.DragEvent<HTMLElement>, folderId: string | null) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setHoveredFolder((current) => current === folderKey(folderId) ? null : current);
  }
  function drop(event: React.DragEvent<HTMLElement>, folderId: string | null, folderName: string) {
    if (!accepts(event, folderId)) return;
    event.preventDefault(); event.stopPropagation();
    const id = event.dataTransfer.getData(CONVERSATION_DRAG);
    const source = conversations.find((c) => c.id === id);
    if (id !== dragId.current || !source) { endDrag(); return; }
    endDrag();
    void moveConversation({ id, folderId, title: source.title, folderName });
  }
  function dropClass(folderId: string | null) {
    return `${draggedConversation && draggedConversation.folderId !== folderId ? " folder-drop-available" : ""}${hoveredFolder === folderKey(folderId) ? " folder-drop-active" : ""}`;
  }
  function renderConversation(c: Conversation) {
    return <div key={c.id} data-testid="conversation-row" data-conversation-id={c.id} className={`conversation-row ${activeId === c.id ? "active" : ""} ${dragging === c.id ? "conversation-dragging" : ""} ${moving === c.id ? "conversation-moving" : ""}`}>
      <button className="conversation-link" aria-current={activeId === c.id ? "page" : undefined} aria-describedby="conversation-drag-hint" title={c.title} draggable={!moving} onPointerDown={() => { draggedGesture.current = false; }} onDragStart={(event) => {
        if (busy.current) { event.preventDefault(); return; }
        event.dataTransfer.setData(CONVERSATION_DRAG, c.id); event.dataTransfer.effectAllowed = "move";
        dragId.current = c.id; draggedGesture.current = true; setDragging(c.id); setHoveredFolder(null); setNotice("");
      }} onDragEnd={endDrag} onClick={(event) => { if (draggedGesture.current && event.detail > 0) { event.preventDefault(); return; } onSelect(c.id); }}>{moving === c.id ? <LoaderCircle size={14} className="spin" /> : c.document ? <FileText size={14} aria-label={c.document.editable ? "原稿" : "資料"} /> : <MessageSquare size={14} />}<span>{c.title}</span></button>
      <button className="sidebar-edit icon-button" aria-label={`${c.title}を編集`} title="タイトル・フォルダを変更" disabled={!!moving} onClick={() => setEditor({ kind: "conversation", row: c })}><MoreHorizontal size={15} /></button>
    </div>;
  }
  return <aside className="sidebar">
    <Link href="/" className="brand" onClick={(e) => { e.preventDefault(); onNewChat(); }}><BrandMark /><span>Fussenn</span></Link>
    <button className="new-chat" onClick={onNewChat}><Plus size={17} />新しい会話<span>↗</span></button>
    <button className="import-document" onClick={props.onImport}><FileText size={16} />資料を開く<span>MD / TXT / PDF</span></button>
    <button className="import-document manuscript-new" onClick={props.onNewManuscript}><FileText size={15} />原稿を書く</button>
    <div className="sidebar-section-label"><span>会話・資料・原稿 <span className="sidebar-total">{conversations.length.toString().padStart(2, "0")}</span></span><button className="icon-button" aria-label="フォルダを作成" title="フォルダを作成" onClick={() => setEditor({ kind: "new-folder" })}><FolderPlus size={15} /></button></div>
    <p id="conversation-drag-hint" className="conversation-drag-hint">{dragging ? "移動先に重ねて、マウスを離す" : "フォルダへドラッグして整理"}</p>
    <nav className="conversation-nav" aria-label="会話一覧">
      {folders.map((folder) => {
        const rows = conversations.filter((c) => c.folderId === folder.id);
        const open = !collapsed.has(folder.id);
        return <section key={folder.id} className={`folder-section${dropClass(folder.id)}`} data-folder-id={folder.id} aria-label={`フォルダ: ${folder.name}`} onDragEnter={(event) => dragOver(event, folder.id)} onDragOver={(event) => dragOver(event, folder.id)} onDragLeave={(event) => dragLeave(event, folder.id)} onDrop={(event) => drop(event, folder.id, folder.name)}>
          <div className="folder-row">
            <button className="folder-toggle" aria-expanded={open} aria-controls={`folder-${folder.id}`} onClick={() => setCollapsed((current) => { const next = new Set(current); if (open) next.add(folder.id); else next.delete(folder.id); return next; })}>
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{open || hoveredFolder === folder.id ? <FolderOpen size={14} /> : <Folder size={14} />}<span title={folder.name}>{folder.name}</span><small>{rows.length}</small>
            </button>
            <button className="sidebar-edit icon-button" aria-label={`${folder.name}フォルダを編集`} title="フォルダを編集" disabled={!!moving} onClick={() => setEditor({ kind: "folder", row: folder })}><MoreHorizontal size={15} /></button>
          </div>
          <div id={`folder-${folder.id}`} className="folder-conversations" hidden={!open}>{rows.map(renderConversation)}{rows.length === 0 && <p className="folder-empty">ここに会話をドロップ</p>}</div>
        </section>;
      })}
      <section className={`folder-section unfiled-section${dropClass(null)}`} data-folder-id="unfiled" aria-label="未分類" onDragEnter={(event) => dragOver(event, null)} onDragOver={(event) => dragOver(event, null)} onDragLeave={(event) => dragLeave(event, null)} onDrop={(event) => drop(event, null, "未分類")}>
        <div className="unfiled-label"><Inbox size={13} /><span>未分類</span><small>{conversations.filter((c) => !c.folderId).length}</small></div>
        {conversations.filter((c) => !c.folderId).map(renderConversation)}
        {conversations.length === 0 && <p className="sidebar-empty">ここから、好奇心の記録を。</p>}
        {conversations.length > 0 && conversations.every((c) => c.folderId) && <p className="folder-empty unfiled-empty">ここに戻すとフォルダから外れます</p>}
      </section>
    </nav>
    {failedMove ? <div className="sidebar-move-error" role="alert"><p>「{failedMove.title}」を移動できませんでした。元の場所に残っています。</p><div><button onClick={() => void moveConversation(failedMove)}>再試行</button><button className="icon-button" aria-label="移動エラーを閉じる" onClick={() => setFailedMove(null)}><X size={12} /></button></div></div> : notice && <p className="sidebar-move-notice" role="status" aria-live="polite">{notice}</p>}
    <div className="sidebar-foot"><div className="local-label"><span className="status-dot" />あなたのPCに保存</div><Link href="/settings" className="settings-link"><Settings2 size={16} />設定<span>v0.2</span></Link></div>
    {editor && <OrganizationEditor editor={editor} folders={folders} onClose={() => setEditor(null)} onSave={async (name, folderId) => {
      if (editor.kind === "conversation") {
        const row = await api<Conversation>(`conversations/${editor.row.id}`, { method: "PATCH", body: JSON.stringify({ ...(name !== editor.row.title ? { title: name } : {}), folderId }) });
        props.onConversationSaved(row);
        if (row.folderId) setCollapsed((current) => { const next = new Set(current); next.delete(row.folderId!); return next; });
      } else {
        const row = await api<ConversationFolder>(editor.kind === "new-folder" ? "folders" : `folders/${editor.row.id}`, { method: editor.kind === "new-folder" ? "POST" : "PATCH", body: JSON.stringify({ name }) });
        props.onFolderSaved(row);
      }
    }} onDelete={editor.kind === "new-folder" ? undefined : async () => {
      if (editor.kind === "folder") { await api(`folders/${editor.row.id}`, { method: "DELETE" }); props.onFolderDeleted(editor.row.id); }
      else { await api(`conversations/${editor.row.id}`, { method: "DELETE" }); props.onConversationDeleted(editor.row.id); }
    }} />}
  </aside>;
}

function OrganizationEditor({ editor, folders, onClose, onSave, onDelete }: {
  editor: Editor; folders: ConversationFolder[]; onClose: () => void;
  onSave: (name: string, folderId: string | null) => Promise<void>; onDelete?: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(editor.kind === "new-folder" ? "" : editor.kind === "folder" ? editor.row.name : editor.row.title);
  const [folderId, setFolderId] = useState(editor.kind === "conversation" ? editor.row.folderId ?? "" : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isConversation = editor.kind === "conversation";
  const itemLabel = isConversation && editor.row.document ? "資料" : "会話";
  const title = confirmDelete ? (isConversation ? `${itemLabel}を削除` : "フォルダを削除") : editor.kind === "new-folder" ? "フォルダを作成" : isConversation ? `${itemLabel}を編集` : "フォルダを編集";
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const input = element.querySelector("input"); input?.focus(); input?.select();
    return () => element.close();
  }, []);
  async function submit() {
    if (saving) return;
    setSaving(true); setError("");
    try {
      if (confirmDelete) await onDelete?.();
      else await onSave(name.trim(), folderId || null);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "保存できませんでした。もう一度お試しください。"); }
    finally { setSaving(false); }
  }
  return <dialog ref={dialog} className="organization-dialog" aria-labelledby="organization-title" onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="organization-heading"><span className="organization-icon">{isConversation ? <MessageSquare size={19} /> : <Folder size={19} />}</span><h2 id="organization-title">{title}</h2><button type="button" className="icon-button" aria-label="編集画面を閉じる" disabled={saving} onClick={onClose}><X size={17} /></button></div>
      {confirmDelete ? <p className="organization-description">{isConversation ? `「${editor.row.title}」と、この${itemLabel}に付いたすべての付箋を削除します。この操作は取り消せません。` : "フォルダのみ削除します。中の会話・資料・原稿、付箋は残り、「未分類」に戻ります。"}</p> : <>
        <label className="organization-field"><span>{isConversation ? `${itemLabel}のタイトル` : "フォルダ名"}</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={isConversation ? 100 : 60} required disabled={saving} placeholder={isConversation ? `${itemLabel}のタイトル` : "例: 仕事、学習、アイデア"} /></label>
        {isConversation && <label className="organization-field"><span>保存先フォルダ</span><select value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={saving}><option value="">未分類</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      </>}
      {error && <p className="organization-error" role="alert">{error}</p>}
      <div className="organization-footer">
        {onDelete && !confirmDelete && <button type="button" className="organization-delete" disabled={saving} onClick={() => { setConfirmDelete(true); setError(""); }}><Trash2 size={13} />{isConversation ? `${itemLabel}を削除` : "フォルダを削除"}</button>}
        <div className="organization-buttons"><button type="button" className="secondary-button" disabled={saving} onClick={() => confirmDelete ? setConfirmDelete(false) : onClose()}>{confirmDelete ? "戻る" : "キャンセル"}</button><button type="submit" className={confirmDelete ? "danger-button" : "primary-button"} disabled={saving || (!confirmDelete && !name.trim())}>{saving ? "処理中…" : confirmDelete ? (isConversation ? `${itemLabel}と付箋を削除` : "フォルダのみ削除") : editor.kind === "new-folder" ? "作成" : "保存"}</button></div>
      </div>
    </form>
  </dialog>;
}
