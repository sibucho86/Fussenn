"use client";
import { useEffect, useRef, useState } from "react";
import { Settings2, X } from "lucide-react";
import { api } from "@/lib/api";
import type { ConversationDetail, ProviderKind, PublicSettings } from "@/lib/types";
import type { CodexModel } from "@/server/providers/codex/client";

const labels: Record<ProviderKind, string> = { codex: "Codex · ChatGPT", openai: "OpenAI API", "openai-compatible": "OpenAI Compatible", mock: "Mock · デモ" };
export function DocumentAISettings({ detail, settings, onSaved, onClose }: { detail: ConversationDetail; settings: PublicSettings; onSaved: (row: ConversationDetail) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [provider, setProvider] = useState(detail.providerKind);
  const [model, setModel] = useState(detail.model);
  const [models, setModels] = useState<CodexModel[]>([]);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    if (provider !== "codex") return;
    let cancelled = false;
    void api<CodexModel[]>("providers/codex/models").then((rows) => { if (!cancelled) { setModels(rows); setModel((value) => value || rows.find((row) => row.isDefault)?.model || rows[0]?.model || ""); } }).catch(() => {});
    return () => { cancelled = true; };
  }, [provider]);
  function close() { if (!pending.current) { dialog.current?.close(); onClose(); } }
  async function save() {
    if (pending.current || !model.trim()) return;
    pending.current = true; setSaving(true); setError("");
    try { const row = await api<ConversationDetail>(`documents/${detail.id}/provider`, { method: "PATCH", body: JSON.stringify({ providerKind: provider, model: model.trim() }) }); dialog.current?.close(); onSaved(row); }
    catch (error) { setError(error instanceof Error ? error.message : "保存できませんでした。"); }
    finally { pending.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className="organization-dialog" aria-label="付箋AIの設定" onCancel={(event) => { event.preventDefault(); close(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="organization-heading"><span className="organization-icon"><Settings2 size={19} /></span><h2 id="document-ai-title">付箋AIの設定</h2><button type="button" className="icon-button" aria-label="付箋AIの設定を閉じる" disabled={saving} onClick={close}><X size={17} /></button></div>
      <p className="organization-description">この資料の付箋で使うAIを選びます。質問すると、資料の全文と選択箇所、質問した付箋の会話を参照します。</p>
      <label className="organization-field"><span>付箋のProvider</span><select value={provider} disabled={saving} onChange={(event) => { const value = event.target.value as ProviderKind; setProvider(value); setModel(value === "mock" ? "mock-demo" : value === "codex" ? settings.codexDefaultModel : value === "openai" ? settings.openaiModel : settings.compatibleModel); }}>{Object.entries(labels).filter(([kind]) => kind !== "mock" || settings.mockEnabled).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
      <label className="organization-field"><span>付箋のModel</span><input value={model} disabled={saving || provider === "mock"} onChange={(event) => setModel(event.target.value)} list="document-ai-models" maxLength={200} placeholder="モデル名" required /><datalist id="document-ai-models">{provider === "codex" && models.map((row) => <option key={row.id} value={row.model}>{row.displayName}</option>)}</datalist></label>
      <p className="document-import-hint">ログインやAPIキーはアプリの「設定」で準備できます。既存のメモと付箋内の会話は引き続き参照できます。</p>
      {error && <p className="organization-error" role="alert">{error}</p>}
      <div className="organization-footer"><div className="organization-buttons"><button type="button" className="secondary-button" disabled={saving} onClick={close}>キャンセル</button><button className="primary-button" type="submit" disabled={saving || !model.trim()}>{saving ? "保存中…" : "保存"}</button></div></div>
    </form>
  </dialog>;
}
