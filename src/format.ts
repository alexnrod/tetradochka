import type { Entry } from "./notebook.ts";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function dateParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { day: get("day"), month: get("month"), year: get("year"), hour: get("hour"), minute: get("minute") };
}

// "28 окт 2026, 14:32"
export function longDate(iso: string, withTime = true): string {
  const d = dateParts(iso);
  const date = `${Number(d.day)} ${MONTHS[Number(d.month) - 1]} ${d.year}`;
  return withTime ? `${date}, ${d.hour}:${d.minute}` : date;
}

// "28.10.2026"
export function shortDate(iso: string): string {
  const d = dateParts(iso);
  return `${d.day}.${d.month}.${d.year}`;
}

export function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const login = (e: Entry) => `<code>@${e.username}</code>`;

export function people(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "человека" : "человек";
  return `${n} ${word}`;
}

export function addedCard(e: Entry): string {
  return [
    "✅ <b>Записано в тетрадочку</b>",
    "",
    `Логин: ${login(e)}`,
    `Когда: ${longDate(e.addedAt)}`,
    `Почему: ${escape(e.addReason)}`,
  ].join("\n");
}

export function activeCard(e: Entry): string {
  return [
    `📓 ${login(e)} уже в тетрадочке`,
    "",
    `Записали: ${longDate(e.addedAt)}`,
    `Почему: ${escape(e.addReason)}`,
  ].join("\n");
}

export function removedCard(e: Entry): string {
  return [
    `<s>@${e.username}</s> · вычеркнуто`,
    "",
    `Записали: ${longDate(e.addedAt, false)}`,
    `Вычеркнули: ${longDate(e.removedAt!)}`,
    `Причина: ${escape(e.removeReason!)}`,
  ].join("\n");
}

export type Page = { text: string; page: number; pages: number };

// Pages are 1-based; an out-of-range page is clamped.
function paginate<T>(items: T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  return { slice: items.slice(start, start + size), start, page: current, pages };
}

// With reasons capped at REASON_LIMIT, a full page stays under Telegram's 4096-character message limit.
export const REASON_LIMIT = 300;
const LIST_PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 5;

export function listPage(entries: Entry[], page: number): Page {
  if (entries.length === 0) return { text: "📓 <b>Тетрадочка</b>\n\nПока пусто.", page: 1, pages: 1 };
  const p = paginate(entries, page, LIST_PAGE_SIZE);
  const rows = p.slice.map(
    (e, i) => `${p.start + i + 1}. ${login(e)} · ${shortDate(e.addedAt)}\n${escape(e.addReason)}`,
  );
  return { text: [`📓 <b>Тетрадочка</b> · ${people(entries.length)}`, ...rows].join("\n\n"), page: p.page, pages: p.pages };
}

export function historyPage(entries: Entry[], page: number): Page {
  if (entries.length === 0) return { text: "🕓 <b>История</b>\n\nНикого не вычёркивали.", page: 1, pages: 1 };
  const p = paginate(entries, page, HISTORY_PAGE_SIZE);
  const rows = p.slice.map((e, i) =>
    [
      `${p.start + i + 1}. <s>@${e.username}</s>`,
      `Записали ${shortDate(e.addedAt)}: ${escape(e.addReason)}`,
      `Вычеркнули ${shortDate(e.removedAt!)}: ${escape(e.removeReason!)}`,
    ].join("\n"),
  );
  return { text: [`🕓 <b>История</b> · вычеркнуто: ${entries.length}`, ...rows].join("\n\n"), page: p.page, pages: p.pages };
}
