import assert from "node:assert/strict";
import { test } from "node:test";
import { longDate, people, shortDate } from "./format.ts";

test("dates use the TZ time zone", () => {
  process.env.TZ = "Europe/Berlin";
  assert.equal(longDate("2026-10-28T13:32:00Z"), "28 окт 2026, 14:32");
  assert.equal(longDate("2026-10-28T13:32:00Z", false), "28 окт 2026");
  assert.equal(shortDate("2026-10-02T13:32:00Z"), "02.10.2026");
});

test("people", () => {
  assert.deepEqual([1, 2, 4, 5, 11, 12, 22, 25].map(people), [
    "1 человек", "2 человека", "4 человека", "5 человек", "11 человек", "12 человек", "22 человека", "25 человек",
  ]);
});
