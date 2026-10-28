import { Bot, type Context, InlineKeyboard } from "grammy";
import {
  REASON_LIMIT,
  activeCard,
  addedCard,
  escape,
  historyPage,
  listPage,
  removedCard,
  type Page,
} from "./format.ts";
import { type Notebook, parseUsername } from "./notebook.ts";

export const DESCRIPTION =
  "Записывай людей по логину в Telegram — с датой и причиной. Вычёркивай тоже с причиной: история помнит, кого и почему убрали из тетрадочки.";
export const SHORT_DESCRIPTION = "Люди по логину в Telegram — с датой и причиной.";

export const COMMANDS = [
  { command: "start", description: "Открыть тетрадочку и главное меню" },
  { command: "add", description: "Записать человека: логин и почему" },
  { command: "remove", description: "Вычеркнуть человека и объяснить причину" },
  { command: "list", description: "Кто сейчас в тетрадочке" },
  { command: "history", description: "Все вычеркнутые — когда и почему" },
];

const GREETING = "Привет! Это твоя тетрадочка. Записывай сюда людей и вычёркивай их — всегда с датой и причиной.";
const ASK_ADD_LOGIN = "Кого записываем? Пришли логин в Telegram, например @username";
const NOT_A_LOGIN = "Не похоже на логин. Пришли его в виде @username";
const TOO_LONG = `Слишком длинно. Уложись в ${REASON_LIMIT} символов.`;
const PICK_LIMIT = 20;

const askAddReason = (u: string) => `Почему записываем <code>@${u}</code>? Напиши пару слов.`;
const askRemoveReason = (u: string) =>
  `За что вычёркиваем <code>@${u}</code>? Причина останется в истории.`;
const notInNotebook = (u: string) => `<code>@${u}</code> нет в тетрадочке.`;

// The step the owner is in while the bot waits for their next message.
// Kept in memory: a restart only drops an unfinished dialog.
type Step =
  | { kind: "add-login" }
  | { kind: "add-reason"; username: string }
  | { kind: "remove-login" }
  | { kind: "remove-reason"; username: string }
  | { kind: "remove-confirm"; username: string; reason: string };

const menu = () =>
  new InlineKeyboard()
    .text("➕ Записать", "add")
    .text("➖ Вычеркнуть", "remove")
    .row()
    .text("📓 Тетрадочка", "list")
    .text("🕓 История", "history");

function pager(prefix: string, p: Page): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (p.pages === 1) return kb;
  if (p.page > 1) kb.text("← Назад", `${prefix}:${p.page - 1}`);
  kb.text(`стр. ${p.page} из ${p.pages}`, "noop");
  if (p.page < p.pages) kb.text("Дальше →", `${prefix}:${p.page + 1}`);
  return kb.row();
}

// Short error text for logs. The full grammY error embeds the request URL, which contains the bot token.
export function describeError(error: unknown): string {
  const cause = (error as { error?: { code?: string } })?.error?.code;
  return cause ? `${error} (${cause})` : String(error);
}

// Splits "@login some reason" into the login (undefined if invalid) and the reason.
function parseArgs(match: string): { first: string; username?: string; reason: string } {
  const [first = "", ...rest] = match.trim().split(/\s+/);
  return { first, username: parseUsername(first), reason: rest.join(" ") };
}

export function createBot(token: string, ownerId: number, notebook: Notebook, botInfo?: Bot["botInfo"]): Bot {
  // Some connections to Telegram from the VM stall silently; grammY's default 500-second timeout would freeze the bot.
  // Long polling waits up to 30 seconds, so 40 seconds still covers a full poll.
  const bot = new Bot(token, { botInfo, client: { timeoutSeconds: 40 } });
  let step: Step | undefined;

  const html = (ctx: Context, text: string, keyboard?: InlineKeyboard) =>
    ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });

  // The notebook is private: updates from anyone but the owner are dropped without a reply.
  bot.use(async (ctx, next) => {
    if (ctx.from?.id === ownerId) await next();
  });

  async function startAdd(ctx: Context, username?: string, reason?: string) {
    if (!username) {
      step = { kind: "add-login" };
      return html(ctx, ASK_ADD_LOGIN);
    }
    const existing = notebook.active(username);
    if (existing) {
      step = undefined;
      return html(ctx, activeCard(existing), new InlineKeyboard().text("📓 Тетрадочка", "list"));
    }
    if (!reason) {
      step = { kind: "add-reason", username };
      return html(ctx, askAddReason(username));
    }
    if (reason.length > REASON_LIMIT) {
      step = { kind: "add-reason", username };
      return html(ctx, TOO_LONG);
    }
    step = undefined;
    const entry = notebook.add(username, reason);
    return html(
      ctx,
      addedCard(entry),
      new InlineKeyboard().text("📓 Тетрадочка", "list").text("➕ Ещё одного", "add"),
    );
  }

  async function startRemove(ctx: Context, username?: string, reason?: string) {
    if (!username) {
      const active = notebook.list();
      if (active.length === 0) {
        step = undefined;
        return html(ctx, "Тетрадочка пуста, вычёркивать некого.", new InlineKeyboard().text("➕ Записать", "add"));
      }
      step = { kind: "remove-login" };
      const kb = new InlineKeyboard();
      active.slice(0, PICK_LIMIT).forEach((e, i) => {
        kb.text(`@${e.username}`, `pick:${e.username}`);
        if (i % 2 === 1) kb.row();
      });
      const hint = active.length > PICK_LIMIT ? "\n\nВ кнопках не все — можно прислать логин сообщением." : "";
      return html(ctx, `Кого вычёркиваем?${hint}`, kb);
    }
    if (!notebook.active(username)) {
      step = undefined;
      return html(ctx, notInNotebook(username));
    }
    if (!reason) {
      step = { kind: "remove-reason", username };
      return html(ctx, askRemoveReason(username));
    }
    if (reason.length > REASON_LIMIT) {
      step = { kind: "remove-reason", username };
      return html(ctx, TOO_LONG);
    }
    step = { kind: "remove-confirm", username, reason };
    return html(
      ctx,
      `⚠️ Точно вычеркнуть <code>@${username}</code>?\n\nПричина: ${escape(reason)}`,
      new InlineKeyboard().text("Отмена", "confirm:no").text("➖ Вычеркнуть", "confirm:yes").danger(),
    );
  }

  const listKeyboard = (p: Page) => pager("list", p).text("➕ Записать", "add").text("➖ Вычеркнуть", "remove");
  const historyKeyboard = (p: Page) => pager("history", p).text("📓 Тетрадочка", "list");

  bot.command("start", (ctx) => {
    step = undefined;
    return html(ctx, GREETING, menu());
  });

  bot.command("add", (ctx) => {
    const { first, username, reason } = parseArgs(ctx.match);
    if (first && !username) return html(ctx, NOT_A_LOGIN);
    return startAdd(ctx, username, reason);
  });

  bot.command("remove", (ctx) => {
    const { first, username, reason } = parseArgs(ctx.match);
    if (first && !username) return html(ctx, NOT_A_LOGIN);
    return startRemove(ctx, username, reason);
  });

  const openList = (ctx: Context) => {
    step = undefined;
    const p = listPage(notebook.list(), 1);
    return html(ctx, p.text, listKeyboard(p));
  };

  const openHistory = (ctx: Context) => {
    step = undefined;
    const p = historyPage(notebook.removed(), 1);
    return html(ctx, p.text, historyKeyboard(p));
  };

  bot.command("list", openList);
  bot.command("history", openHistory);

  bot.on("message:text", (ctx) => {
    const text = ctx.message.text.trim();
    switch (step?.kind) {
      case "add-login":
      case "remove-login": {
        const username = parseUsername(text);
        if (!username) return html(ctx, NOT_A_LOGIN);
        return step.kind === "add-login" ? startAdd(ctx, username) : startRemove(ctx, username);
      }
      case "add-reason":
        return startAdd(ctx, step.username, text);
      case "remove-reason":
        return startRemove(ctx, step.username, text);
      default:
        step = undefined;
        return html(ctx, GREETING, menu());
    }
  });

  bot.on("message", (ctx) => html(ctx, GREETING, menu()));

  bot.callbackQuery("add", async (ctx) => {
    await ctx.answerCallbackQuery();
    await startAdd(ctx);
  });

  bot.callbackQuery("remove", async (ctx) => {
    await ctx.answerCallbackQuery();
    await startRemove(ctx);
  });

  bot.callbackQuery(/^pick:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startRemove(ctx, ctx.match[1]);
  });

  bot.callbackQuery(/^confirm:(yes|no)$/, async (ctx) => {
    const pending = step?.kind === "remove-confirm" ? step : undefined;
    step = undefined;
    await ctx.editMessageReplyMarkup();
    if (!pending) {
      await ctx.answerCallbackQuery("Это подтверждение устарело");
      return;
    }
    if (ctx.match[1] === "no") {
      await ctx.answerCallbackQuery("Отменено");
      return;
    }
    await ctx.answerCallbackQuery();
    const entry = notebook.remove(pending.username, pending.reason);
    if (!entry) return html(ctx, notInNotebook(pending.username));
    await html(
      ctx,
      removedCard(entry),
      new InlineKeyboard().text("📓 Тетрадочка", "list").text("🕓 История", "history"),
    );
  });

  bot.callbackQuery("list", async (ctx) => {
    await ctx.answerCallbackQuery();
    await openList(ctx);
  });

  bot.callbackQuery("history", async (ctx) => {
    await ctx.answerCallbackQuery();
    await openHistory(ctx);
  });

  // Paging buttons edit the page message in place.
  bot.callbackQuery(/^(list|history):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const page = Number(ctx.match[2]);
    if (ctx.match[1] === "list") {
      const p = listPage(notebook.list(), page);
      await ctx.editMessageText(p.text, { parse_mode: "HTML", reply_markup: listKeyboard(p) });
    } else {
      const p = historyPage(notebook.removed(), page);
      await ctx.editMessageText(p.text, { parse_mode: "HTML", reply_markup: historyKeyboard(p) });
    }
  });

  bot.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());

  bot.catch((err) => console.error("Update failed:", describeError(err.error)));

  return bot;
}
