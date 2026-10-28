import assert from "node:assert/strict";
import { test } from "node:test";
import { Notebook, parseUsername } from "./notebook.ts";

test("add, remove and re-add keep every removal", () => {
  const nb = new Notebook(":memory:");
  nb.add("Ivan_Petrov", "met at a conference", new Date("2026-01-01T10:00:00Z"));
  assert.equal(nb.active("ivan_petrov")?.addReason, "met at a conference");

  const removed = nb.remove("IVAN_PETROV", "moved away", new Date("2026-02-01T10:00:00Z"));
  assert.equal(removed?.removeReason, "moved away");
  assert.equal(nb.active("ivan_petrov"), undefined);
  assert.deepEqual(nb.list(), []);

  nb.add("ivan_petrov", "came back", new Date("2026-03-01T10:00:00Z"));
  assert.deepEqual(nb.list().map((e) => e.addReason), ["came back"]);
  assert.deepEqual(nb.removed().map((e) => e.removeReason), ["moved away"]);
});

test("a username can be active only once", () => {
  const nb = new Notebook(":memory:");
  nb.add("someone", "first");
  assert.throws(() => nb.add("SOMEONE", "second"));
});

test("remove of an absent username returns undefined", () => {
  const nb = new Notebook(":memory:");
  assert.equal(nb.remove("nobody", "why"), undefined);
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
