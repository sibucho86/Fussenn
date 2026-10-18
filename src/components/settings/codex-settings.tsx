"use client";
import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { CodexModel, CodexStatus, LoginResult } from "@/server/providers/codex/client";

export function CodexSettings({ model, onModel }: { model: string; onModel: (model: string) => void }) {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [models, setModels] = useState<CodexModel[]>([]);
  const [login, setLogin] = useState<LoginResult | null>(null);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const status = await api<CodexStatus>("providers/codex/status");
    setStatus(status);
    setConnectionError("");
    if (status.signedIn) {
      setLogin(null);
      const available = await api<CodexModel[]>("providers/codex/models");
      setModels(available);
      if (!model) onModel((available.find((m) => m.isDefault) ?? available[0])?.model ?? "");
    } else setModels([]);
  }
  useEffect(() => {
    // Also observe changes from another tab/CLI and login completion after a reload.
    // Foreground checks never replace unsaved provider/model preferences.
    if (busy || login) return;
    let cancelled = false;
    let pending = false;
    let modelsLoaded = false;
    async function check() {
      if (cancelled || pending) return;
      pending = true;
      try {
        const s = await api<CodexStatus>("providers/codex/status");
        if (cancelled) return;
        setStatus(s);
        if (!s.signedIn) { setModels([]); modelsLoaded = false; }
        else if (!modelsLoaded) {
          const available = await api<CodexModel[]>("providers/codex/models");
          if (cancelled) return;
          setModels(available); modelsLoaded = true;
        }
        setConnectionError("");
      } catch (e) {
        if (!cancelled) setConnectionError(e instanceof Error ? e.message : "認証状態を確認できませんでした。");
      } finally { pending = false; }
    }
    const checkVisible = () => { if (document.visibilityState === "visible") void check(); };
    void check();
    window.addEventListener("focus", checkVisible);
    document.addEventListener("visibilitychange", checkVisible);
    const timer = setInterval(checkVisible, 10_000);
    return () => {
      cancelled = true; clearInterval(timer);
      window.removeEventListener("focus", checkVisible);
      document.removeEventListener("visibilitychange", checkVisible);
    };
  }, [busy, login]);
  useEffect(() => {
    if (!login) return;
    const expiresAt = Date.now() + 5 * 60_000;
    let pending = false;
    let cancelled = false;
    const timer = setInterval(() => {
      if (pending) return;
      if (Date.now() > expiresAt) { clearInterval(timer); setLogin(null); setError("ログインの確認がタイムアウトしました。接続状態を更新してください。"); return; }
      pending = true;
      void api<CodexStatus>("providers/codex/status").then(async (s) => {
        if (cancelled) return;
        setStatus(s);
        if (s.signedIn) setLogin(null);
        else if (s.loginError) { setLogin(null); setError(s.loginError); }
      }).catch((e) => { if (!cancelled) setError(e.message); }).finally(() => { pending = false; });
    }, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [login]);
  async function startLogin(device: boolean) {
    // Open synchronously so the browser does not treat the auth tab as a popup.
    const tab = device || window.fussennDesktop ? null : window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setBusy(true); setError("");
    try {
      const result = await api<LoginResult>(`providers/codex/login${device ? "/device" : ""}`, { method: "POST" });
      setLogin(result);
      if (result.type === "chatgpt" && tab) tab.location.replace(result.authUrl);
      if (result.type === "chatgpt" && window.fussennDesktop) await window.fussennDesktop.openLogin(result.authUrl);
    } catch (e) { tab?.close(); setError(e instanceof Error ? e.message : "ログインを開始できませんでした。"); }
    finally { setBusy(false); }
  }
  return <div className="codex-settings">
    <div className="codex-status-row"><span className={`connection-status ${status?.signedIn ? "connected" : ""}`}><span className="status-dot" />{!status ? "接続を確認しています…" : status.signedIn ? `ChatGPTにサインイン済み${status.plan ? ` · ${status.plan}` : ""}` : "未サインイン"}</span><button className="text-button" onClick={() => void refresh().catch((e) => setError(e.message))}><RefreshCw size={12} />更新</button></div>
    {status?.error && <p className="settings-error">{status.error}</p>}
    {status?.signedIn ? <>
      <label className="setting-field"><span>Model</span><select aria-label="Codex Model" value={model} onChange={(e) => onModel(e.target.value)}><option value="">会話開始時に標準モデルを使用</option>{model && !models.some((m) => m.model === model) && <option value={model}>{model}</option>}{models.map((m) => <option key={m.id} value={m.model}>{m.displayName}{m.isDefault ? "（標準）" : ""}</option>)}</select></label>
      <button className="codex-logout text-button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api("providers/codex/logout", { method: "POST" }); await refresh(); }
        catch (e) { setError(e instanceof Error ? e.message : "ログアウトできませんでした。"); }
        finally { setBusy(false); }
      }}>ログアウト</button>
    </> : <div className="codex-login-actions"><button className="primary-button" disabled={busy || !status?.installed} onClick={() => void startLogin(false)}>ChatGPTでサインイン</button><button className="secondary-button" disabled={busy || !status?.installed} onClick={() => void startLogin(true)}>Device Codeを使う</button></div>}
    {login && <div className="login-instructions">{login.type === "chatgptDeviceCode" ? <><p>以下のページを開き、このコードを入力してください。</p><strong className="device-code">{login.userCode}</strong><a href={login.verificationUrl} target="_blank" rel="noopener noreferrer">認証ページを開く<ExternalLink size={12} /></a></> : <a href={login.authUrl} target="_blank" rel="noopener noreferrer">ログイン用ブラウザを開く<ExternalLink size={12} /></a>}<p>ログイン完了を待っています…</p></div>}
    {(error || connectionError) && <p className="settings-error" role="alert">{error || connectionError}</p>}
    <p className="settings-help">既存のCodex CLIログインを再利用します。利用できるモデル・利用枠は、ChatGPTアカウントのCodex subscription accessに従います。</p>
  </div>;
}
