"use client";
import { useEffect, useState } from "react";
import { flushDesktopSaves } from "@/lib/desktop";

export function DesktopLifecycle() {
  const [saving, setSaving] = useState(false);
  useEffect(() => window.fussennDesktop?.onBeforeClose(async () => {
    setSaving(true);
    try { return await flushDesktopSaves(); }
    finally { setSaving(false); }
  }), []);
  return saving ? <div className="desktop-saving" role="status">保存しています…</div> : null;
}
