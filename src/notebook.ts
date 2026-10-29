import { DatabaseSync } from "node:sqlite";

// "telegram": a Telegram account, known by login, account id or phone; "offline": a person without Telegram, known by name.
export type Kind = "telegram" | "offline";

export type Person = {
  kind: Kind;
  username?: string;
  userId?: number;
  name?: string;
  phone?: string;
};

export type Entry = Person & {
  id: number;
  addedAt: string;
  addReason: string;
  removedAt: string | null;
  removeReason: string | null;
};

type Row = {
  id: number;
  kind: Kind;
  username: string | null;
  user_id: number | null;
  name: string | null;
  phone: string | null;
  added_at: string;
  add_reason: string;
  removed_at: string | null;
  remove_reason: string | null;
};

const toEntry = (r: Row): Entry => ({
  id: r.id,
  kind: r.kind,
  username: r.username ?? undefined,
  userId: r.user_id ?? undefined,
  name: r.name ?? undefined,
  phone: r.phone ?? undefined,
  addedAt: r.added_at,
  addReason: r.add_reason,
  removedAt: r.removed_at,
  removeReason: r.remove_reason,
});

const SCHEMA = `
  CREATE TABLE entries (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('telegram', 'offline')),
    username TEXT COLLATE NOCASE,
    user_id INTEGER,
    name TEXT,
    phone TEXT,
    added_at TEXT NOT NULL,
    add_reason TEXT NOT NULL,
    removed_at TEXT,
    remove_reason TEXT
  );
  CREATE UNIQUE INDEX entries_active ON entries(username) WHERE removed_at IS NULL;
  CREATE UNIQUE INDEX entries_active_user ON entries(user_id) WHERE removed_at IS NULL;
  CREATE UNIQUE INDEX entries_active_phone ON entries(phone) WHERE removed_at IS NULL;
`;

// A person can be added again after removal, so each stay in the notebook is its own row.
// At most one active row (removed_at IS NULL) exists per login, account id and phone.
export class Notebook {
  #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#migrate();
  }

  // user_version 0 is either an empty file or the first schema, where every entry had a login.
  #migrate(): void {
    const { user_version } = this.#db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (user_version >= 1) return;
    const exists = this.#db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entries'").get();
    this.#db.exec("BEGIN");
    if (exists) {
      this.#db.exec(`
        DROP INDEX entries_active;
        ALTER TABLE entries RENAME TO entries_v0;
        ${SCHEMA}
        INSERT INTO entries (id, kind, username, added_at, add_reason, removed_at, remove_reason)
          SELECT id, 'telegram', username, added_at, add_reason, removed_at, remove_reason FROM entries_v0;
        DROP TABLE entries_v0;
      `);
    } else {
      this.#db.exec(SCHEMA);
    }
    this.#db.exec("PRAGMA user_version = 1; COMMIT");
  }

  get(id: number): Entry | undefined {
    const row = this.#db.prepare("SELECT * FROM entries WHERE id = ? AND removed_at IS NULL").get(id) as
      | Row
      | undefined;
    return row && toEntry(row);
  }

  active(username: string): Entry | undefined {
    return this.activeAs({ kind: "telegram", username });
  }

  // The active entry that shares a login, account id or phone with the person. Names are not unique.
  activeAs(p: Person): Entry | undefined {
    const row = this.#db
      .prepare(
        "SELECT * FROM entries WHERE removed_at IS NULL AND (username = ? OR user_id = ? OR phone = ?) LIMIT 1",
      )
      .get(p.username ?? null, p.userId ?? null, p.phone ?? null) as Row | undefined;
    return row && toEntry(row);
  }

  // Active entries that match a login, phone or exact name, case-insensitively.
  // SQLite's lower() only folds ASCII, so Cyrillic names are compared here.
  search(text: string): Entry[] {
    const username = parseUsername(text)?.toLowerCase();
    const phone = parsePhone(text);
    const name = text.trim().toLocaleLowerCase();
    return this.list().filter(
      (e) =>
        (username && e.username?.toLowerCase() === username) ||
        (phone && e.phone === phone) ||
        e.name?.toLocaleLowerCase() === name,
    );
  }

  add(p: Person, reason: string, now = new Date()): Entry {
    const row = this.#db
      .prepare(
        `INSERT INTO entries (kind, username, user_id, name, phone, added_at, add_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        p.kind,
        p.username ?? null,
        p.userId ?? null,
        p.name ?? null,
        p.phone ?? null,
        now.toISOString(),
        reason,
      ) as Row;
    return toEntry(row);
  }

  remove(id: number, reason: string, now = new Date()): Entry | undefined {
    const row = this.#db
      .prepare(
        "UPDATE entries SET removed_at = ?, remove_reason = ? WHERE id = ? AND removed_at IS NULL RETURNING *",
      )
      .get(now.toISOString(), reason, id) as Row | undefined;
    return row && toEntry(row);
  }

  list(): Entry[] {
    const rows = this.#db
      .prepare("SELECT * FROM entries WHERE removed_at IS NULL ORDER BY added_at")
      .all() as Row[];
    return rows.map(toEntry);
  }

  // Removed entries, most recently removed first.
  removed(): Entry[] {
    const rows = this.#db
      .prepare("SELECT * FROM entries WHERE removed_at IS NOT NULL ORDER BY removed_at DESC")
      .all() as Row[];
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

// Accepts phone numbers with spaces, dashes and brackets; returns "+<digits>" or undefined.
// A Russian "8XXXXXXXXXX" becomes "+7XXXXXXXXXX", so a typed number matches the one in a shared contact.
export function parsePhone(raw: string): string | undefined {
  const text = raw.trim();
  if (!/^\+?[\d\s()-]+$/.test(text)) return undefined;
  let digits = text.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8") && !text.startsWith("+")) digits = `7${digits.slice(1)}`;
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : undefined;
}
