"use client";
import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, Download, History, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { announceRestore, workspaceFetch } from "@/lib/workspace-request";
import { MAX_BACKUP_BYTES, type BackupCounts, type BackupPreview, type BackupStatus, type RestoreResult } from "@/lib/backup";

const labels: [keyof BackupCounts, string][] = [["conversations", "会話"], ["documents", "資料"], ["notes", "付箋"], ["messages", "発言"], ["folders", "フォルダ"]];
const date = (value: string) => new Date(value).toLocaleString("ja-JP");
const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
async function checked(response: Response) {
  if (!response.ok) { const body = await response.json(); throw new Error(body.error || "バックアップを処理できませんでした。"); }
  return response;
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a"); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
export function BackupSettings() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let cancelled = false;
    void api<BackupStatus>("backups").then((value) => { if (!cancelled) setStatus(value); }).catch((e) => { if (!cancelled) setError(e.message); });
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        if (sessionStorage.getItem("fussenn-restore-complete")) {
          setNotice("バックアップから復元しました。復元前の状態は、下の自動退避から取り出せます。");
          sessionStorage.removeItem("fussenn-restore-complete");
        }
      } catch { /* Restoration does not depend on browser storage. */ }
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (preview && !dialog.current?.open) dialog.current?.showModal(); }, [preview]);
  async function work(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "処理に失敗しました。もう一度お試しください。"); }
    finally { pending.current = false; setBusy(false); }
  }
  async function inspect(selected: File) {
    if (!/\.json$/i.test(selected.name) || !selected.size || selected.size > MAX_BACKUP_BYTES) throw new Error("64MB以内のFussennのバックアップ（.fussenn.json、名称変更前の .sidenote.json も可）を選んでください。");
    const response = await checked(await workspaceFetch("backups/inspect", { method: "POST", body: selected, headers: { "Content-Type": "application/json" } }));
    setFile(selected); setPreview(await response.json());
  }
  function close() {
    if (pending.current) return;
    dialog.current?.close(); setPreview(null); setFile(null); setError("");
  }
  async function restore() {
    if (!file || !preview) return;
    await work(async () => {
      const response = await checked(await workspaceFetch("backups/restore", { method: "POST", body: file, headers: { "Content-Type": "application/json", "X-Fussenn-Backup-Digest": preview.digest } }, true));
      await response.json() as RestoreResult;
      announceRestore();
      try { sessionStorage.setItem("fussenn-restore-complete", "1"); } catch { /* A reload still applies restored settings. */ }
      window.location.replace("/settings");
    });
  }
  return <section className="settings-card backup-settings" aria-labelledby="backup-title">
    <div className="settings-card-title"><ArchiveRestore size={19} /><div><h2 id="backup-title">バックアップと復元</h2><p>会話・資料・付箋・配置・フォルダと保存済みの設定を、ひとまとめに保管します。</p></div></div>
    {status && <div className="backup-counts">{labels.filter(([key]) => key !== "messages").map(([key, label]) => <span key={key}>{label}<strong>{status.counts[key].toLocaleString()}</strong></span>)}</div>}
    <div className="backup-actions">
      <button className="primary-button" disabled={busy} onClick={() => void work(async () => {
        const response = await checked(await workspaceFetch("backups/export"));
        const name = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "Fussenn-backup.fussenn.json";
        saveBlob(await response.blob(), name); setNotice("バックアップのダウンロードを開始しました。");
      })}><Download size={14} />バックアップを保存</button>
      <button className="secondary-button" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} />バックアップから復元</button>
      <input ref={input} type="file" className="backup-file-input" aria-label="復元するバックアップファイル" accept=".json,application/json" disabled={busy} onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void work(() => inspect(selected)); }} />
    </div>
    <p className="settings-help">Fussenn専用ファイル（.fussenn.json、64MBまで。名称変更前の .sidenote.json も復元できます）。保存済みの内容が対象です。ログイン情報・APIキーは含みません。AIの回答中は、完了してから操作してください。</p>
    {busy && <p className="backup-notice" role="status">バックアップを処理しています…</p>}
    {notice && <p className="backup-notice" role="status">{notice}</p>}
    {error && !preview && <p className="settings-error" role="alert">{error}</p>}
    {status?.schedule && <div className="backup-schedule">
      <label className="backup-schedule-toggle"><input type="checkbox" checked={status.schedule.enabled} disabled={busy} onChange={(event) => {
        const enabled = event.target.checked;
        void work(async () => { await api("backups/schedule", { method: "PATCH", body: JSON.stringify({ enabled }) }); setStatus(await api<BackupStatus>("backups")); });
      }} />1日1回、自動でバックアップする</label>
      <p className="settings-help">アプリの起動中に保存します。終了中に予定を過ぎた場合は、次の起動時に保存します。AIの回答中は完了を待ちます。定期分は最新{status.schedule.keep}件を保持します。</p>
      <p className="settings-help">前回の保存：{status.schedule.lastSuccessAt ? date(new Date(status.schedule.lastSuccessAt).toISOString()) : "まだありません"}{status.schedule.enabled && status.schedule.nextDueAt !== null && <> · 次回：{status.schedule.lastSuccessAt === null ? "次の自動確認時" : date(new Date(status.schedule.nextDueAt).toISOString())}</>}</p>
      {status.schedule.lastError && <p className="settings-error" role="alert">{status.schedule.lastError}</p>}
      <button className="secondary-button" disabled={busy} onClick={() => void work(async () => { await api("backups/scheduled", { method: "POST" }); setStatus(await api<BackupStatus>("backups")); setNotice("このPCにバックアップを保存しました。"); })}>今すぐPCに保存</button>
    </div>}
    <div className="backup-history"><h3><History size={15} />自動バックアップと復元前の退避</h3><p className="settings-help">定期保存と復元直前の退避を、新しい順に20件表示します。復元前の退避は自動削除しません。</p>
      {status?.automaticBackups.length ? <ul>{status.automaticBackups.map((backup) => <li key={backup.name}><div><strong>{date(backup.createdAt)}</strong><span>{backup.kind === "scheduled" ? "定期バックアップ" : "復元前の退避"} · {size(backup.bytes)}</span></div><div className="backup-history-actions"><button className="text-button" disabled={busy} onClick={() => void work(async () => {
        const response = await checked(await workspaceFetch(`backups/automatic/${encodeURIComponent(backup.name)}`));
        saveBlob(await response.blob(), backup.name); setNotice("自動退避ファイルのダウンロードを開始しました。");
      })}>ダウンロード</button><button className="secondary-button" disabled={busy} onClick={() => void work(async () => {
        const response = await checked(await workspaceFetch(`backups/automatic/${encodeURIComponent(backup.name)}`));
        await inspect(new File([await response.blob()], backup.name, { type: "application/json" }));
      })}>この状態に戻す</button></div></li>)}</ul> : <p className="backup-empty">自動バックアップはまだありません。</p>}
      {status && <p className="backup-directory">保存先：<span>{status.directory}</span></p>}
      <button className="text-button" disabled={busy} onClick={() => void work(async () => { setStatus(await api<BackupStatus>("backups")); })}>一覧を更新</button>
    </div>
    <dialog ref={dialog} className="organization-dialog backup-dialog" aria-labelledby="restore-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="organization-heading"><h2 id="restore-title">バックアップから復元</h2><button className="icon-button" aria-label="復元確認を閉じる" disabled={busy} onClick={close}><X size={17} /></button></div>
      {preview && <><p className="backup-file-name">{file?.name}</p><p className="settings-help">保存日時：{date(preview.createdAt)} · {size(preview.bytes)}</p>
        <table className="backup-preview"><thead><tr><th>内容</th><th>現在</th><th>復元後</th></tr></thead><tbody>{labels.map(([key, label]) => <tr key={key}><th>{label}</th><td>{preview.currentCounts[key].toLocaleString()}</td><td>{preview.counts[key].toLocaleString()}</td></tr>)}</tbody></table>
        <p className="organization-description">現在の会話・資料・付箋・フォルダと保存済み設定を、このバックアップの内容に置き換えます。先に現在の状態を自動退避するので、後から戻せます。</p>
        <p className="settings-help">復元後、この画面は再読み込みされます。ほかのタブでは保存を停止し、再読み込みを案内します。</p>
        {error && <p className="settings-error" role="alert">{error}</p>}
        <div className="organization-buttons"><button className="secondary-button" disabled={busy} onClick={close}>キャンセル</button><button className="primary-button" disabled={busy} onClick={() => void restore()}>{busy ? "復元しています…" : "現在の状態を退避して復元"}</button></div>
      </>}
    </dialog>
  </section>;
}
