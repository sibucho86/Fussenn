export const NOTE_COLORS = ["yellow", "pink", "blue", "green", "lavender"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const NOTE_COLOR_LABELS: Record<NoteColor, string> = {
  yellow: "黄色", pink: "ピンク", blue: "ブルー", green: "グリーン", lavender: "ラベンダー",
};
