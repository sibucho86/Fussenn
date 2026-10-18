import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { databaseFile, dataDirectory } from "./location";
import * as schema from "./schema";

export { dataDirectory };

export function openDatabase(filename: string) {
  const sqlite = new Database(filename);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  // Versioned, transactional migration; never replace or reset user data.
  if ((sqlite.pragma("user_version", { simple: true }) as number) < 1) {
    sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, provider_kind TEXT NOT NULL, model TEXT NOT NULL, provider_session_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('streaming','complete','error')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE UNIQUE INDEX messages_sequence ON messages(conversation_id, sequence);
        CREATE TABLE side_notes (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, parent_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, selected_text TEXT NOT NULL, anchor_start INTEGER NOT NULL, anchor_end INTEGER NOT NULL, anchor_prefix TEXT NOT NULL, anchor_suffix TEXT NOT NULL, anchor_version INTEGER NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('memo','chat')), memo TEXT NOT NULL, context_snapshot_json TEXT NOT NULL, provider_session_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX notes_conversation ON side_notes(conversation_id);
        CREATE TABLE side_note_messages (id TEXT PRIMARY KEY, side_note_id TEXT NOT NULL REFERENCES side_notes(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('streaming','complete','error')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE UNIQUE INDEX note_messages_sequence ON side_note_messages(side_note_id, sequence);
        CREATE TABLE side_note_layouts (side_note_id TEXT PRIMARY KEY REFERENCES side_notes(id) ON DELETE CASCADE, layout_type TEXT NOT NULL DEFAULT 'desktop', x INTEGER NOT NULL, y INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, collapsed INTEGER NOT NULL, z_index INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 1;
      `);
    })();
  }
  if ((sqlite.pragma("user_version", { simple: true }) as number) < 2) {
    sqlite.transaction(() => {
      sqlite.exec("ALTER TABLE side_notes ADD COLUMN color TEXT NOT NULL DEFAULT 'yellow' CHECK(color IN ('yellow','pink','blue','green','lavender')); PRAGMA user_version = 2;");
    })();
  }
  if ((sqlite.pragma("user_version", { simple: true }) as number) < 3) {
    sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE conversation_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        ALTER TABLE conversations ADD COLUMN folder_id TEXT REFERENCES conversation_folders(id) ON DELETE SET NULL;
        ALTER TABLE conversations ADD COLUMN title_edited INTEGER NOT NULL DEFAULT 0 CHECK(title_edited IN (0, 1));
        CREATE INDEX conversations_folder ON conversations(folder_id);
        PRAGMA user_version = 3;
      `);
    })();
  }
  if ((sqlite.pragma("user_version", { simple: true }) as number) < 4) {
    sqlite.transaction(() => {
      sqlite.exec("ALTER TABLE side_note_layouts ADD COLUMN minimized INTEGER NOT NULL DEFAULT 0 CHECK(minimized IN (0, 1)); PRAGMA user_version = 4;");
    })();
  }
  if ((sqlite.pragma("user_version", { simple: true }) as number) < 5) {
    sqlite.transaction(() => {
      sqlite.exec("ALTER TABLE side_note_layouts ADD COLUMN connector_json TEXT; PRAGMA user_version = 5;");
    })();
  }
  if ((sqlite.pragma("user_version", { simple: true }) as number) < 6) {
    sqlite.transaction(() => {
      sqlite.exec(`CREATE TABLE document_sources (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('markdown','text'))
      ); PRAGMA user_version = 6;`);
    })();
  }
  if ((sqlite.pragma("user_version", { simple: true }) as number) < 7) {
    sqlite.transaction(() => {
      sqlite.exec("CREATE TABLE workspace_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), revision TEXT NOT NULL); INSERT INTO workspace_metadata VALUES (1, lower(hex(randomblob(16)))); PRAGMA user_version = 7;");
    })();
  }
  // A previous server crash must not leave conversations permanently streaming.
  if ((sqlite.pragma("user_version", { simple: true }) as number) < 8) {
    sqlite.transaction(() => {
      sqlite.exec(`CREATE TABLE backup_schedule (
        id INTEGER PRIMARY KEY CHECK(id = 1), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        last_attempt_at INTEGER, last_success_at INTEGER, last_file TEXT, last_error TEXT
      ); INSERT INTO backup_schedule(id) VALUES(1); PRAGMA user_version = 8;`);
    })();
  }
  if ((sqlite.pragma("user_version", { simple: true }) as number) < 9) {
    sqlite.transaction(() => {
      sqlite.exec(`
        ALTER TABLE document_sources ADD COLUMN editable INTEGER NOT NULL DEFAULT 0 CHECK(editable IN (0,1));
        ALTER TABLE document_sources ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE manuscript_notes (
          side_note_id TEXT PRIMARY KEY REFERENCES side_notes(id) ON DELETE CASCADE,
          draft TEXT NOT NULL DEFAULT '', draft_revision INTEGER NOT NULL DEFAULT 0,
          start_offset INTEGER, end_offset INTEGER, original_text TEXT NOT NULL,
          base_revision INTEGER NOT NULL, applied_revision INTEGER, context_revision INTEGER NOT NULL,
          history_from INTEGER NOT NULL DEFAULT 0, context_history_json TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE manuscript_revisions (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL, content TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL,
          anchors_json TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX manuscript_revision_number ON manuscript_revisions(conversation_id, revision);
        PRAGMA user_version = 9;
      `);
    })();
  }
  if ((sqlite.pragma("user_version", { simple: true }) as number) < 10) {
    sqlite.transaction(() => {
      sqlite.exec(`CREATE TABLE document_sources_pdf (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('markdown','text','pdf')),
        editable INTEGER NOT NULL DEFAULT 0 CHECK(editable IN (0,1)), revision INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO document_sources_pdf SELECT conversation_id, message_id, file_name, format, editable, revision FROM document_sources;
      DROP TABLE document_sources;
      ALTER TABLE document_sources_pdf RENAME TO document_sources;
      PRAGMA user_version = 10;`);
    })();
  }
  sqlite.exec("UPDATE messages SET status = 'error' WHERE status = 'streaming'; UPDATE side_note_messages SET status = 'error' WHERE status = 'streaming';");
  return { db: drizzle(sqlite, { schema }), sqlite };
}
export type AppDatabase = ReturnType<typeof openDatabase>["db"];
const globalDb = globalThis as typeof globalThis & { fussennDatabase?: ReturnType<typeof openDatabase> };
export function getDatabaseHandle() {
  if (!globalDb.fussennDatabase) {
    const dir = dataDirectory();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    globalDb.fussennDatabase = openDatabase(databaseFile(dir));
  }
  return globalDb.fussennDatabase;
}
export function getDatabase() { return getDatabaseHandle().db; }
