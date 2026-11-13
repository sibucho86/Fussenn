"use client";
import { SunMoon } from "lucide-react";
import { TEXT_SIZES, THEMES } from "@/lib/appearance";
import { setAppearance, useAppearance } from "@/lib/appearance-store";

export function AppearanceSettings() {
  const appearance = useAppearance();
  return <section className="settings-card appearance-settings" aria-labelledby="appearance-title">
    <div className="settings-card-title"><SunMoon size={19} /><div><h2 id="appearance-title">表示 <span>この端末</span></h2><p>選ぶと、すぐに切り替わります。保存ボタンは要りません。バックアップには含まれません。</p></div></div>
    <fieldset className="appearance-field"><legend>配色</legend><div className="segmented">{THEMES.map((option) => <label key={option.value}><input type="radio" name="appearance-theme" value={option.value} checked={appearance.theme === option.value} onChange={() => setAppearance({ theme: option.value })} /><span>{option.label}</span></label>)}</div></fieldset>
    <fieldset className="appearance-field"><legend>文字の大きさ</legend><div className="segmented">{TEXT_SIZES.map((option) => <label key={option.value}><input type="radio" name="appearance-text-size" value={option.value} checked={appearance.textSize === option.value} onChange={() => setAppearance({ textSize: option.value })} /><span>{option.label}</span></label>)}</div></fieldset>
    <p className="appearance-sample" aria-hidden="true">理解を、余白に。AIの回答に付箋を貼って、気になることをその場で聞けます。</p>
  </section>;
}
