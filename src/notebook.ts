import { DatabaseSync } from "node:sqlite";

export type Entry = {
  id: number;
  username: string;
  addedAt: string;
  addReason: string;
  removedAt: string | null;
  removeReason: string | null;
};

type Row = {
  id: number;
  username: string;
  added_at: string;
  add_reason: string;
  removed_at: string | null;
  remove_reason: string | null;
};

const toEntry = (r: Row): Entry => ({
  id: r.id,
  username: r.username,
  addedAt: r.added_at,
  addReason: r.add_reason,
  removedAt: r.removed_at,
  removeReason: r.remove_reason,
});

// A person can be added again after removal, so each stay in the notebook is its own row.
// At most one row per username is active (removed_at IS NULL).
export class Notebook {
  #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE,
        added_at TEXT NOT NULL,
        add_reason TEXT NOT NULL,
        removed_at TEXT,
        remove_reason TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS entries_active ON entries(username) WHERE removed_at IS NULL;
    `);
  }

  active(username: string): Entry | undefined {
    const row = this.#db
      .prepare("SELECT * FROM entries WHERE username = ? AND removed_at IS NULL")
      .get(username) as Row | undefined;
    return row && toEntry(row);
  }

  add(username: string, reason: string, now = new Date()): Entry {
    const row = this.#db
      .prepare("INSERT INTO entries (username, added_at, add_reason) VALUES (?, ?, ?) RETURNING *")
      .get(username, now.toISOString(), reason) as Row;
    return toEntry(row);
  }

  remove(username: string, reason: string, now = new Date()): Entry | undefined {
    const row = this.#db
      .prepare(
        "UPDATE entries SET removed_at = ?, remove_reason = ? WHERE username = ? AND removed_at IS NULL RETURNING *",
      )
      .get(now.toISOString(), reason, username) as Row | undefined;
    return row && toEntry(row);
  }

  list(): Entry[] {
    const rows = this.#db
      .prepare("SELECT * FROM entries WHERE removed_at IS NULL ORDER BY added_at")
      .all() as Row[];
    return rows.map(toEntry);
  }

  history(username: string): Entry[] {
    const rows = this.#db
      .prepare("SELECT * FROM entries WHERE username = ? ORDER BY added_at")
      .all(username) as Row[];
    return rows.map(toEntry);
  }

  close(): void {
    this.#db.close();
  }
}

// Accepts "@login", "login" and "t.me/login" links; returns the bare login or undefined.
export function parseUsername(raw: string): string | undefined {
  const login = raw.trim().replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, "").replace(/^@/, "");
  return /^[a-z][a-z0-9_]{3,31}$/i.test(login) ? login : undefined;
}
