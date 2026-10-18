"use client";
import { useEffect, useState } from "react";
import { markWorkspaceStale } from "@/lib/workspace-request";

export function WorkspaceRevisionGuard() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const changed = () => setStale(true);
    const storage = (event: StorageEvent) => { if (event.key === "fussenn-restored") markWorkspaceStale(); };
    window.addEventListener("fussenn-workspace-changed", changed);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener("fussenn-workspace-changed", changed); window.removeEventListener("storage", storage); };
  }, []);
  return stale ? <div className="workspace-restored-banner" role="alert"><span>データが復元されました。この画面からの保存を停止しています。必要な下書きをコピーしてから再読み込みしてください。</span><button className="primary-button" onClick={() => window.location.reload()}>再読み込み</button></div> : null;
}
