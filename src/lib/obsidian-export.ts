import { strToU8, zip } from "fflate";
import { NOTE_COLOR_LABELS } from "./note-colors";
import type { ConversationDetail, Message } from "./types";

type ExportOptions = { folderName?: string | null; exportedAt?: Date };
export type MarkdownExport = { archiveName: string; files: Record<string, string> };

// Keep paths portable on Windows and safe inside Obsidian wikilinks. IDs distinguish identical titles.
function filenameText(value: string) {
  return Array.from(value.normalize("NFC").replace(/[\p{Cc}\p{Cf}<>:"/\\|?*#^\[\]%]/gu, " ").replace(/\s+/g, " ").trim())
    .slice(0, 24).join("").replace(/[. ]+$/g, "") || "ノート";
}
function inlineText(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/[&<>\[\]|*_`~\\#^]/g, (character) => `&#${character.charCodeAt(0)};`);
}
function wikilink(filename: string, label: string, block?: string) {
  return `[[${filename.slice(0, -3)}${block ? `#^${block}` : ""}|${inlineText(label)}]]`;
}
function frontmatter(values: Record<string, string | number | string[]>) {
  return `---\n${Object.entries(values).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n`;
}
const iso = (timestamp: number) => new Date(timestamp).toISOString();
const messageAnchor = (message: Message) => `fussenn-message-${message.id}`;

// An interrupted answer can end inside a code fence. Close it so the next message and links stay readable.
function markdownBody(content: string) {
  let fence: { marker: string; length: number } | null = null;
  for (const line of content.split(/\r?\n/)) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    if (fence) {
      if (match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) fence = null;
    } else if (match[1][0] !== "`" || !match[2].includes("`")) {
      fence = { marker: match[1][0], length: match[1].length };
    }
  }
  return `${content || "（本文なし）"}${fence ? `\n${fence.marker.repeat(fence.length)}` : ""}\n\n`;
}
function messageMarkdown(message: Message, number: number, links = "") {
  const status = message.status === "streaming" ? "> 書き出し時点で生成中の回答です。途中までの内容を収録しています。\n\n"
    : message.status === "error" ? "> 中断された回答です。\n\n" : "";
  return `### 発言 ${number} · ${message.role === "user" ? "あなた" : "AI"}\n\n${iso(message.createdAt)} ^${messageAnchor(message)}\n\n${links}${status}${markdownBody(message.content)}`;
}

export function buildObsidianFiles(conversation: ConversationDetail, options: ExportOptions = {}): MarkdownExport {
  const exportedAt = (options.exportedAt ?? new Date()).toISOString();
  const document = conversation.document;
  const itemLabel = document?.editable ? "原稿" : document ? "資料" : "会話";
  const root = `Fussenn-${conversation.id}`;
  const mainFile = `${itemLabel} - ${filenameText(conversation.title)} - ${conversation.id}.md`;
  const notes = [...conversation.notes].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const messages = [...conversation.messages].sort((a, b) => a.sequence - b.sequence);
  const noteFiles = new Map(notes.map((note) => [note.id, `付箋 - ${filenameText(note.selectedText)} - ${note.id}.md`]));
  const files: Record<string, string> = {};
  let main = frontmatter({ title: conversation.title, aliases: [conversation.title], fussenn_type: document?.editable ? "manuscript" : document ? "document" : "conversation", fussenn_id: conversation.id,
    created: iso(conversation.createdAt), exported: exportedAt, folder: options.folderName ?? "未分類", provider: conversation.providerKind, model: conversation.model,
    ...(document ? { source_file: document.fileName, source_format: document.format } : {}) });
  main += `# ${inlineText(conversation.title)}\n\n## 付箋一覧\n\n`;
  main += notes.length ? notes.map((note) => `- ${wikilink(noteFiles.get(note.id)!, note.selectedText)} · ${NOTE_COLOR_LABELS[note.color]}`).join("\n") + "\n\n" : `この${itemLabel}には付箋がありません。\n\n`;
  if (document) {
    const source = messages.find((message) => message.id === document.messageId);
    main += document.editable ? "## 原稿本文\n\n" : "## 資料本文\n\n";
    if (source) {
      main += `${inlineText(document.fileName)} · ${iso(conversation.createdAt)} 取り込み ^${messageAnchor(source)}\n\n`;
      if (document.format !== "markdown") {
        const fence = "`".repeat(Math.max(2, ...Array.from(source.content.matchAll(/`+/g), (match) => match[0].length)) + 1);
        main += `${fence}text\n${source.content}\n${fence}\n\n`;
      } else main += markdownBody(source.content);
    } else main += "資料の本文が見つかりません。\n";
  } else {
    main += "## 会話\n\n";
    main += messages.length ? messages.map((message, index) => {
    const attached = notes.filter((note) => note.parentMessageId === message.id);
    const links = attached.length ? `付箋：${attached.map((note) => wikilink(noteFiles.get(note.id)!, note.selectedText)).join(" · ")}\n\n` : "";
    return messageMarkdown(message, index + 1, links);
    }).join("---\n\n") : "まだメッセージがありません。\n";
  }
  files[`${root}/${mainFile}`] = main;

  for (const note of notes) {
    const parent = messages.find((message) => message.id === note.parentMessageId);
    let markdown = frontmatter({ title: note.selectedText, aliases: [note.selectedText.replace(/\s+/g, " ").trim()], fussenn_type: "note", fussenn_id: note.id,
      conversation_id: conversation.id, parent_message_id: note.parentMessageId, color: note.color, created: iso(note.createdAt), exported: exportedAt });
    markdown += `# ${inlineText(note.selectedText)}\n\n`;
    markdown += parent ? `${wikilink(mainFile, document ? "元の資料へ戻る" : "元の発言へ戻る", messageAnchor(parent))} · ${wikilink(mainFile, `${itemLabel}全体`)}\n\n`
      : `${wikilink(mainFile, `${itemLabel}全体`)}\n\n元の${document ? "資料" : "発言"}が見つかりません。選択した原文は下に残しています。\n\n`;
    markdown += `## 選択した原文\n\n${(note.manuscript?.originalText || note.selectedText).split(/\r?\n/).map((line) => `> ${inlineText(line)}`).join("\n")}\n\n`;
    if (note.manuscript) markdown += `## 原稿案\n\n${markdownBody(note.manuscript.draft)}状態：${note.manuscript.appliedRevision !== null ? `版 ${note.manuscript.appliedRevision} に反映済み` : "推敲中"}\n\nAI参照：版 ${note.manuscript.contextRevision}\n\n`;
    markdown += `## メモ\n\n${note.memo ? markdownBody(note.memo) : "（メモなし）\n\n"}## 付箋内の会話\n\n`;
    markdown += note.messages.length ? [...note.messages].sort((a, b) => a.sequence - b.sequence).map((message, index) => messageMarkdown(message, index + 1)).join("---\n\n") : "（付箋内の会話なし）\n";
    files[`${root}/${noteFiles.get(note.id)!}`] = markdown;
  }
  files[`${root}/使い方.txt`] = `Fussenn → Obsidian\n\n1. ZIPを展開してください。\n2. 展開した「${root}」フォルダを丸ごとObsidianの保管庫へ入れてください。保管庫内のサブフォルダでも使えます。\n3. 「${mainFile}」を開いてください。\n\n${itemLabel}の付箋リンクから個別のノートを開けます。付箋の「元の${document ? "資料" : "発言"}へ戻る」で、参照元の先頭へ戻れます。選択した原文も各付箋に引用しています。\n\n表示・折りたたみ・収納の状態によらず、この${itemLabel}の全付箋を収録しています。メモは書き出しボタンを押した時点の内容です。生成中・中断された回答には状態を記載しています。送信していない質問は含みません。\n\n付箋の位置や引き出し線の見た目はMarkdownには含みません。リンク先の外部ファイルや画像は同梱しません。書き出した付箋の再取り込みや自動同期は行いません。\n`;
  return { archiveName: `Fussenn-${filenameText(conversation.title)}-${conversation.id}.zip`, files };
}

export async function createObsidianArchive(conversation: ConversationDetail, options: ExportOptions = {}) {
  const { archiveName, files } = buildObsidianFiles(conversation, options);
  const entries = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)]));
  const data = await new Promise<Uint8Array>((resolve, reject) => zip(entries, { level: 6 }, (error, result) => error ? reject(error) : resolve(result)));
  return { archiveName, data };
}
