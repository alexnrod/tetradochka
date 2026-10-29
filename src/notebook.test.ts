import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Notebook, parsePhone, parseUsername } from "./notebook.ts";

const login = (username: string) => ({ kind: "telegram" as const, username });

test("add, remove and re-add keep every removal", () => {
  const nb = new Notebook(":memory:");
  nb.add(login("Ivan_Petrov"), "met at a conference", new Date("2026-01-01T10:00:00Z"));
  const entry = nb.active("ivan_petrov")!;
  assert.equal(entry.addReason, "met at a conference");

  const removed = nb.remove(entry.id, "moved away", new Date("2026-02-01T10:00:00Z"));
  assert.equal(removed?.removeReason, "moved away");
  assert.equal(nb.active("ivan_petrov"), undefined);
  assert.deepEqual(nb.list(), []);

  nb.add(login("ivan_petrov"), "came back", new Date("2026-03-01T10:00:00Z"));
  assert.deepEqual(nb.list().map((e) => e.addReason), ["came back"]);
  assert.deepEqual(nb.removed().map((e) => e.removeReason), ["moved away"]);
});

test("a login, account id or phone can be active only once", () => {
  const nb = new Notebook(":memory:");
  nb.add(login("someone"), "first");
  assert.throws(() => nb.add(login("SOMEONE"), "second"));
  nb.add({ kind: "telegram", userId: 7, phone: "+79161234567", name: "Иван Петров" }, "first");
  assert.equal(nb.activeAs({ kind: "telegram", userId: 7 })?.name, "Иван Петров");
  assert.equal(nb.activeAs({ kind: "offline", phone: "+79161234567" })?.userId, 7);
  assert.throws(() => nb.add({ kind: "telegram", userId: 7 }, "second"));
});

test("people without Telegram may share a name", () => {
  const nb = new Notebook(":memory:");
  nb.add({ kind: "offline", name: "Иван Петров" }, "сосед");
  nb.add({ kind: "offline", name: "Иван Петров" }, "коллега");
  assert.equal(nb.activeAs({ kind: "offline", name: "Иван Петров" }), undefined);
  assert.deepEqual(nb.search("иван петров").map((e) => e.addReason), ["сосед", "коллега"]);
});

test("search finds by login, phone and name", () => {
  const nb = new Notebook(":memory:");
  nb.add(login("durov"), "a");
  nb.add({ kind: "telegram", phone: "+79161234567", name: "Маша" }, "b");
  assert.deepEqual(nb.search("@Durov").map((e) => e.addReason), ["a"]);
  assert.deepEqual(nb.search("8 916 123-45-67").map((e) => e.addReason), ["b"]);
  assert.deepEqual(nb.search("маша").map((e) => e.addReason), ["b"]);
  assert.deepEqual(nb.search("никто"), []);
});

test("remove of an absent entry returns undefined", () => {
  const nb = new Notebook(":memory:");
  assert.equal(nb.remove(1, "why"), undefined);
});

test("the first schema migrates to logins of kind telegram", () => {
  const path = join(mkdtempSync(join(tmpdir(), "tetradochka-")), "notebook.db");
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE,
      added_at TEXT NOT NULL,
      add_reason TEXT NOT NULL,
      removed_at TEXT,
      remove_reason TEXT
    );
    CREATE UNIQUE INDEX entries_active ON entries(username) WHERE removed_at IS NULL;
    INSERT INTO entries (username, added_at, add_reason) VALUES ('masha_k', '2026-01-01T10:00:00.000Z', 'reason');
  `);
  old.close();

  const nb = new Notebook(path);
  assert.equal(nb.active("MASHA_K")?.kind, "telegram");
  nb.add({ kind: "offline", name: "Иван Петров" }, "сосед");
  nb.close();
  assert.equal(new Notebook(path).list().length, 2);
});

test("parseUsername", () => {
  assert.equal(parseUsername("@durov"), "durov");
  assert.equal(parseUsername("durov"), "durov");
  assert.equal(parseUsername("https://t.me/durov"), "durov");
  assert.equal(parseUsername("t.me/Durov_1"), "Durov_1");
  assert.equal(parseUsername("@ab"), undefined);
  assert.equal(parseUsername("@1durov"), undefined);
  assert.equal(parseUsername("du rov"), undefined);
});

test("parsePhone", () => {
  assert.equal(parsePhone("+7 (916) 123-45-67"), "+79161234567");
  assert.equal(parsePhone("8 916 123 45 67"), "+79161234567");
  assert.equal(parsePhone("79161234567"), "+79161234567");
  assert.equal(parsePhone("+49 151 2345678"), "+491512345678");
  assert.equal(parsePhone("12345"), undefined);
  assert.equal(parsePhone("Иван"), undefined);
});
