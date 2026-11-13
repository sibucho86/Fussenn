"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, KeyRound, Settings2, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import type { ProviderKind, PublicSettings, Settings } from "@/lib/types";
import { api } from "@/lib/api";
import { CodexSettings } from "./codex-settings";
import { BackupSettings } from "./backup-settings";
import { AppearanceSettings } from "./appearance-settings";

const labels: Record<ProviderKind, string> = { codex: "Codex · ChatGPT", openai: "OpenAI API", "openai-compatible": "OpenAI Compatible", mock: "Mock · デモ" };
export default function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void api<PublicSettings>("settings").then(setSettings).catch((e) => setError(e.message)); }, []);
  function change(patch: Partial<Settings>) { setSaved(false); setSettings((s) => s ? { ...s, ...patch } : s); }
  async function save() {
    if (!settings) return;
    setSaving(true); setError("");
    const { defaultProvider, codexDefaultModel, openaiModel, compatibleBaseUrl, compatibleModel } = settings;
    try {
      setSettings(await api<PublicSettings>("settings", { method: "PATCH", body: JSON.stringify({ defaultProvider, codexDefaultModel, openaiModel, compatibleBaseUrl, compatibleModel }) }));
      setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : "設定を保存できませんでした。"); }
    finally { setSaving(false); }
  }
  return <main className="settings-page"><header className="settings-header"><Link href="/" className="brand"><BrandMark /><span>Fussenn</span></Link><Link href="/" className="back-link"><ArrowLeft size={14} />ワークスペースへ戻る</Link></header>
    <div className="settings-content"><span className="eyebrow">MAKE ROOM FOR YOUR CURIOSITY</span><h1><Settings2 size={26} strokeWidth={1.3} />ワークスペースの設定</h1><p className="settings-lead">使いたいAIを選んで、自分のペースで理解を深めましょう。</p>
      {error && <div className="settings-error" role="alert">{error}</div>}
      <AppearanceSettings />
      {!settings ? <p className="loading-state">設定を読み込んでいます…</p> : <>
        <section className="settings-card"><div className="settings-card-title"><span className="settings-number">01</span><div><h2>新しい会話のデフォルト</h2><p>Providerとモデルは、会話を始めると固定されます。付箋も同じ設定を使います。</p></div></div>
          <label className="setting-field"><span>Provider</span><select aria-label="デフォルトProvider" value={settings.defaultProvider} onChange={(e) => change({ defaultProvider: e.target.value as ProviderKind })}>{Object.entries(labels).filter(([p]) => p !== "mock" || settings.mockEnabled).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </section>
        <section className="settings-card"><div className="settings-card-title"><span className="settings-number">02</span><div><h2>Codex <span>ChatGPT</span></h2><p>Codex CLIのChatGPTログインを利用します。</p></div></div><CodexSettings model={settings.codexDefaultModel} onModel={(codexDefaultModel) => change({ codexDefaultModel })} /></section>
        <section className="settings-card"><div className="settings-card-title"><span className="settings-number">03</span><div><h2>OpenAI API</h2><p>ご自身のAPIキーで接続します。</p></div><span className={`connection-status ${settings.openaiKeyConfigured ? "connected" : ""}`}><span className="status-dot" />{settings.openaiKeyConfigured ? "キー設定済み" : "キー未設定"}</span></div>
          <label className="setting-field"><span>Model</span><input aria-label="OpenAI Model" value={settings.openaiModel} placeholder="利用するモデル名を入力" onChange={(e) => change({ openaiModel: e.target.value })} maxLength={200} /></label>
          <div className="setting-secret"><KeyRound size={14} /><span><code>.env.local</code> の <code>OPENAI_API_KEY</code> に設定し、サーバーを再起動してください。</span></div>
        </section>
        <section className="settings-card"><div className="settings-card-title"><span className="settings-number">04</span><div><h2>OpenAI Compatible</h2><p>ローカルモデルやOpenAI互換のサービスに接続します。</p></div></div>
          <label className="setting-field"><span>Base URL</span><input aria-label="Compatible Base URL" value={settings.compatibleBaseUrl} onChange={(e) => change({ compatibleBaseUrl: e.target.value })} placeholder="http://localhost:11434/v1" /></label>
          <label className="setting-field"><span>Model</span><input aria-label="Compatible Model" value={settings.compatibleModel} onChange={(e) => change({ compatibleModel: e.target.value })} placeholder="サーバーにあるモデル名" maxLength={200} /></label>
          <div className="setting-secret"><KeyRound size={14} /><span>APIキーが必要な場合は <code>OPENAI_COMPAT_API_KEY</code> に設定。キーなしのローカルサーバーも使えます。</span></div>
        </section>
        {settings.mockEnabled && <section className="settings-card mock-settings"><div className="settings-card-title"><span className="settings-number">05</span><div><h2>Mock Provider <span>開発・テスト用</span></h2><p>APIキー不要。外部に送信せず、決まったデモ回答で付箋の操作を試せます。</p></div><span className="connection-status connected"><span className="status-dot" />有効</span></div></section>}
        <div className="settings-save-row"><span>{saved && <><Check size={14} />設定を保存しました</>}</span><button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "設定を保存"}</button></div>
      </>}
      <BackupSettings />
      <div className="privacy-note"><ShieldCheck size={18} /><div><strong>あなたのデータは、あなたのPCに。</strong><p>会話と付箋はローカルのSQLiteに保存されます。AIに質問した内容と必要な文脈だけが、選択したProviderへ送信されます。APIキーやOAuthトークンをアプリのDBに保存することはありません。</p></div></div>
    </div>
  </main>;
}
