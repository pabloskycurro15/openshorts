import fs from 'node:fs';
import path from 'node:path';
import { Database } from './sqlite';

export type { Database };

/**
 * Migraciones en orden. Nunca editar una migración ya publicada: añadir una nueva.
 * La versión aplicada se guarda en PRAGMA user_version.
 */
const MIGRATIONS: string[] = [
  // 1 — auditoría (solo inserción), concesiones de permisos, aprobaciones, ajustes
  `
  CREATE TABLE audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    principal_kind TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    outcome TEXT NOT NULL,
    details TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log es de solo inserción'); END;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log es de solo inserción'); END;

  CREATE TABLE permission_grants (
    id TEXT PRIMARY KEY,
    principal_kind TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('allow','ask')),
    granted_at TEXT NOT NULL,
    UNIQUE (principal_kind, principal_id, scope)
  );

  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    principal_kind TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    args TEXT NOT NULL,
    scopes TEXT NOT NULL,
    risk TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2 — secretos cifrados, conversaciones, mensajes y consumo de IA
  `
  CREATE TABLE secrets (
    name TEXT PRIMARY KEY,
    iv BLOB NOT NULL,
    tag BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    raw TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX messages_conv ON messages(conversation_id, seq);

  CREATE TABLE ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    conversation_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cache_write_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL
  );
  CREATE INDEX ai_usage_ts ON ai_usage(ts);
  `,
  // 3 — consumo de síntesis de voz externa
  `
  CREATE TABLE voice_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    provider TEXT NOT NULL,
    chars INTEGER NOT NULL
  );
  CREATE INDEX voice_usage_ts ON voice_usage(ts);
  `,
  // 4 — memoria: recuerdos, relaciones e índices de texto (palabras y trigramas)
  `
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    project TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    confidence REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('confirmed','suggested')),
    sensitive INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    embedding BLOB,
    embedding_model TEXT
  );
  CREATE INDEX memories_cat ON memories(category, status);
  CREATE INDEX memories_project ON memories(project);
  CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, title, content, tags, tokenize = 'unicode61 remove_diacritics 2');
  CREATE VIRTUAL TABLE memories_tri USING fts5(id UNINDEXED, text, tokenize = 'trigram');
  CREATE TABLE memory_links (
    from_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (from_id, to_id, relation)
  );
  `,
  // 5 — multiagente: tareas, subtareas y ajustes por agente
  `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    status TEXT NOT NULL,
    result TEXT,
    error TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE TABLE subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    agent_id TEXT NOT NULL,
    title TEXT NOT NULL,
    instructions TEXT NOT NULL,
    status TEXT NOT NULL,
    result TEXT,
    error TEXT,
    model TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    log TEXT NOT NULL DEFAULT '[]',
    started_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX subtasks_task ON subtasks(task_id, idx);
  CREATE TABLE agent_settings (agent_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
  `,
  // 6 — conectores: registro de actividad
  `
  CREATE TABLE connector_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    connector TEXT NOT NULL,
    operation TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('ok','error','info')),
    detail TEXT NOT NULL
  );
  CREATE INDEX connector_log_c ON connector_log(connector, id);
  `,
  // 7 — automatizaciones y su historial
  `
  CREATE TABLE automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    trigger TEXT NOT NULL,
    action TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    proposed INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    retries INTEGER NOT NULL DEFAULT 1,
    max_runs_per_day INTEGER NOT NULL DEFAULT 24,
    grants TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL DEFAULT '{}',
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE automation_runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    trigger_label TEXT NOT NULL,
    event TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    log TEXT NOT NULL DEFAULT '[]',
    result TEXT,
    error TEXT,
    cost_usd REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX automation_runs_a ON automation_runs(automation_id, started_at);
  `,
  // 8 — dispositivos vinculados y suscripciones de notificaciones push
  `
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    last_ip TEXT,
    revoked_at TEXT
  );
  CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    device_id TEXT,
    endpoint TEXT NOT NULL UNIQUE,
    keys TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // 9 — copias de seguridad y alertas de seguridad
  `
  CREATE TABLE backups (
    id TEXT PRIMARY KEY,
    file TEXT NOT NULL,
    location TEXT NOT NULL CHECK (location IN ('local','supabase')),
    created_at TEXT NOT NULL,
    size INTEGER NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    verify_detail TEXT,
    auto INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE security_alerts (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info','warning','critical')),
    rule TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    action TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0
  );
  `,
];

export function openDatabase(file: string): Database {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: Database): number {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return MIGRATIONS.length;
}

export function getSetting(db: Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: Database, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}
