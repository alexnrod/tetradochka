import type { Entry, Person } from "./notebook.ts";

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

// Each kind has its own look: a login, 👤 for a Telegram account without a login, ✍️ for a person without Telegram.
const TELEGRAM_MARK = "👤";
const OFFLINE_MARK = "✍️";

const nameOf = (p: Person) => p.name ?? p.phone ?? "без имени";

// One line for lists, history and buttons.
export function plainLabel(p: Person): string {
  if (p.username) return p.name ? `@${p.username} (${p.name})` : `@${p.username}`;
  return `${p.kind === "telegram" ? TELEGRAM_MARK : OFFLINE_MARK} ${nameOf(p)}`;
}

export function label(p: Person): string {
  if (p.username) return `<code>@${p.username}</code>` + (p.name ? ` (${escape(p.name)})` : "");
  const phone = p.name && p.phone ? ` · <code>${p.phone}</code>` : "";
  return `${p.kind === "telegram" ? TELEGRAM_MARK : OFFLINE_MARK} ${escape(nameOf(p))}${phone}`;
}

// Card lines that name the kind and every known detail.
function details(p: Person): string[] {
  const lines = p.username
    ? [`Логин: <code>@${p.username}</code>`, ...(p.name ? [`Имя: ${escape(p.name)}`] : [])]
    : [`${p.kind === "telegram" ? "Telegram без логина" : "Без Telegram"}: ${escape(p.name ?? "—")}`];
  if (p.phone) lines.push(`Телефон: <code>${p.phone}</code>`);
  return lines;
}

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
    ...details(e),
    `Когда: ${longDate(e.addedAt)}`,
    `Почему: ${escape(e.addReason)}`,
  ].join("\n");
}

export function activeCard(e: Entry): string {
  return [
    `📓 ${label(e)} уже в тетрадочке`,
    "",
    `Записали: ${longDate(e.addedAt)}`,
    `Почему: ${escape(e.addReason)}`,
  ].join("\n");
}

export function removedCard(e: Entry): string {
  return [
    `<s>${escape(plainLabel(e))}</s> · вычеркнуто`,
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
// Names are capped at NAME_LIMIT for the same reason.
export const REASON_LIMIT = 300;
export const NAME_LIMIT = 60;
const LIST_PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 5;

// "📎 2" after an entry with attachments. The link sends "/start files_<id>" to the bot, which replies with the files.
function filesLink(e: Entry, bot: string): string {
  return e.files ? ` · <a href="https://t.me/${bot}?start=files_${e.id}">📎 ${e.files}</a>` : "";
}

export function listPage(entries: Entry[], page: number, bot: string): Page {
  if (entries.length === 0) return { text: "📓 <b>Тетрадочка</b>\n\nПока пусто.", page: 1, pages: 1 };
  const p = paginate(entries, page, LIST_PAGE_SIZE);
  const rows = p.slice.map(
    (e, i) =>
      `${p.start + i + 1}. ${label(e)} · ${shortDate(e.addedAt)}${filesLink(e, bot)}\n${escape(e.addReason)}`,
  );
  return { text: [`📓 <b>Тетрадочка</b> · ${people(entries.length)}`, ...rows].join("\n\n"), page: p.page, pages: p.pages };
}

export function historyPage(entries: Entry[], page: number, bot: string): Page {
  if (entries.length === 0) return { text: "🕓 <b>История</b>\n\nНикого не вычёркивали.", page: 1, pages: 1 };
  const p = paginate(entries, page, HISTORY_PAGE_SIZE);
  const rows = p.slice.map((e, i) =>
    [
      `${p.start + i + 1}. <s>${escape(plainLabel(e))}</s>${filesLink(e, bot)}`,
      `Записали ${shortDate(e.addedAt)}: ${escape(e.addReason)}`,
      `Вычеркнули ${shortDate(e.removedAt!)}: ${escape(e.removeReason!)}`,
    ].join("\n"),
  );
  return { text: [`🕓 <b>История</b> · вычеркнуто: ${entries.length}`, ...rows].join("\n\n"), page: p.page, pages: p.pages };
}
