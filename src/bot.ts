import { Bot, type Context } from "grammy";
import { type Entry, type Notebook, parseUsername } from "./notebook.ts";

const HELP = `Моя тетрадочка

/add @логин причина — добавить человека
/remove @логин причина — удалить человека
/list — кто сейчас в тетрадочке
/show @логин — вся история по человеку`;

// Telegram rejects messages longer than 4096 characters.
const MESSAGE_LIMIT = 4000;

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: process.env.TZ,
});
const formatDate = (iso: string) => dateFormat.format(new Date(iso));

function formatEntry(e: Entry): string {
  const lines = [`@${e.username}`, `  добавлен ${formatDate(e.addedAt)}: ${e.addReason}`];
  if (e.removedAt) lines.push(`  удалён ${formatDate(e.removedAt)}: ${e.removeReason}`);
  return lines.join("\n");
}

async function replyChunked(ctx: Context, blocks: string[]): Promise<void> {
  let message = "";
  for (const block of blocks) {
    if (message && message.length + block.length + 2 > MESSAGE_LIMIT) {
      await ctx.reply(message);
      message = "";
    }
    message = message ? `${message}\n\n${block}` : block;
  }
  if (message) await ctx.reply(message);
}

// Splits "@login some reason" into the login and the reason.
function parseArgs(match: string): { username?: string; reason: string } {
  const [first = "", ...rest] = match.trim().split(/\s+/);
  return { username: parseUsername(first), reason: rest.join(" ") };
}

export function createBot(token: string, ownerId: number, notebook: Notebook): Bot {
  const bot = new Bot(token);

  // The notebook is private: updates from anyone but the owner are dropped without a reply.
  bot.use(async (ctx, next) => {
    if (ctx.from?.id === ownerId) await next();
  });

  bot.command(["start", "help"], (ctx) => ctx.reply(HELP));

  bot.command("add", async (ctx) => {
    const { username, reason } = parseArgs(ctx.match);
    if (!username || !reason) return ctx.reply("Формат: /add @логин причина");
    const existing = notebook.active(username);
    if (existing) return ctx.reply(`Уже в тетрадочке:\n\n${formatEntry(existing)}`);
    const entry = notebook.add(username, reason);
    return ctx.reply(`Добавлен:\n\n${formatEntry(entry)}`);
  });

  bot.command("remove", async (ctx) => {
    const { username, reason } = parseArgs(ctx.match);
    if (!username || !reason) return ctx.reply("Формат: /remove @логин причина");
    const entry = notebook.remove(username, reason);
    if (!entry) return ctx.reply(`@${username} нет в тетрадочке.`);
    return ctx.reply(`Удалён:\n\n${formatEntry(entry)}`);
  });

  bot.command("list", async (ctx) => {
    const entries = notebook.list();
    if (entries.length === 0) return ctx.reply("Тетрадочка пуста.");
    await replyChunked(ctx, [`В тетрадочке: ${entries.length}`, ...entries.map(formatEntry)]);
  });

  bot.command("show", async (ctx) => {
    const { username } = parseArgs(ctx.match);
    if (!username) return ctx.reply("Формат: /show @логин");
    const entries = notebook.history(username);
    if (entries.length === 0) return ctx.reply(`@${username} никогда не был в тетрадочке.`);
    await replyChunked(ctx, entries.map(formatEntry));
  });

  bot.on("message", (ctx) => ctx.reply(HELP));

  bot.catch((err) => console.error("Update failed", err.error));

  return bot;
}

export const COMMANDS = [
  { command: "add", description: "Добавить: @логин причина" },
  { command: "remove", description: "Удалить: @логин причина" },
  { command: "list", description: "Кто сейчас в тетрадочке" },
  { command: "show", description: "История: @логин" },
];
