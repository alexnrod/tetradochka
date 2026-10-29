import { Bot, type Context, InlineKeyboard, Keyboard } from "grammy";
import {
  NAME_LIMIT,
  REASON_LIMIT,
  activeCard,
  addedCard,
  escape,
  historyPage,
  label,
  listPage,
  plainLabel,
  removedCard,
  type Page,
} from "./format.ts";
import { type Entry, type Notebook, type Person, parsePhone, parseUsername } from "./notebook.ts";

export const DESCRIPTION =
  "Записывай людей — по логину, аккаунту в Telegram или просто по имени, с датой и причиной. Вычёркивай тоже с причиной: история помнит, кого и почему убрали из тетрадочки.";
export const SHORT_DESCRIPTION = "Люди в тетрадочке — с датой и причиной.";

export const COMMANDS = [
  { command: "start", description: "Открыть тетрадочку и главное меню" },
  { command: "add", description: "Записать человека и почему" },
  { command: "remove", description: "Вычеркнуть человека и объяснить причину" },
  { command: "list", description: "Кто сейчас в тетрадочке" },
  { command: "history", description: "Все вычеркнутые — когда и почему" },
];

const GREETING = "Привет! Это твоя тетрадочка. Записывай сюда людей и вычёркивай их — всегда с датой и причиной.";
const PICK_USER = "👤 Выбрать в Telegram";
const NO_TELEGRAM = "✍️ Без Telegram";
const ASK_ADD_WHO = [
  "Кого записываем? Пришли логин (@username) или телефон, выбери человека кнопкой «👤 Выбрать в Telegram» или пришли его контакт.",
  "",
  "Если у человека нет Telegram, нажми «✍️ Без Telegram».",
].join("\n");
const NOT_A_PERSON = "Не похоже на логин или телефон. Пришли @username, номер телефона или выбери вариант кнопкой.";
const NOT_A_LOGIN = "Не похоже на логин. Пришли его в виде @username";
const ASK_NAME = "Как зовут? Напиши имя и фамилию.";
const ASK_REMOVE_WHO = "Не нашёл такого в тетрадочке. Пришли логин, телефон или имя и фамилию, как записано.";
const TOO_LONG = `Слишком длинно. Уложись в ${REASON_LIMIT} символов.`;
const NAME_TOO_LONG = `Слишком длинно. Уложись в ${NAME_LIMIT} символов.`;
const PICK_LIMIT = 20;
// Identifies the "pick a user" button in the users_shared update.
const PICK_USER_REQUEST = 1;

const askName = (p: Person) =>
  p.phone ? `Как зовут человека с номером <code>${p.phone}</code>? Напиши имя и фамилию.` : ASK_NAME;
const askAddReason = (p: Person) => `Почему записываем ${label(p)}? Напиши пару слов.`;
const askRemoveReason = (p: Person) => `За что вычёркиваем ${label(p)}? Причина останется в истории.`;
const notInNotebook = (p: Person) => `${label(p)} нет в тетрадочке.`;

const fullName = (first?: string, last?: string) =>
  [first, last].filter(Boolean).join(" ").slice(0, NAME_LIMIT) || undefined;

// The step the owner is in while the bot waits for their next message.
// Kept in memory: a restart only drops an unfinished dialog.
type Step =
  | { kind: "add-who" }
  | { kind: "add-name"; person: Person }
  | { kind: "add-reason"; person: Person }
  | { kind: "remove-who" }
  | { kind: "remove-reason"; entry: Entry }
  | { kind: "remove-confirm"; entry: Entry; reason: string };

// Telegram sends the picked user or contact as a message, so these buttons live in a reply keyboard under the input field.
const whoKeyboard = () =>
  new Keyboard()
    .requestUsers(PICK_USER, PICK_USER_REQUEST, { user_is_bot: false, request_name: true, request_username: true })
    .text(NO_TELEGRAM)
    .resized()
    .oneTime();

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
  // Once the add dialog moves past "add-who", the next message without buttons removes its reply keyboard.
  let replyKeyboard = false;

  const html = (ctx: Context, text: string, keyboard?: InlineKeyboard | Keyboard) => {
    let markup: InlineKeyboard | Keyboard | { remove_keyboard: true } | undefined = keyboard;
    if (keyboard instanceof Keyboard) replyKeyboard = true;
    else if (!keyboard && replyKeyboard && step?.kind !== "add-who") {
      markup = { remove_keyboard: true };
      replyKeyboard = false;
    }
    return ctx.reply(text, { parse_mode: "HTML", reply_markup: markup });
  };

  // The notebook is private: updates from anyone but the owner are dropped without a reply.
  bot.use(async (ctx, next) => {
    if (ctx.from?.id === ownerId) await next();
  });

  async function startAdd(ctx: Context, person?: Person, reason?: string) {
    if (!person) {
      step = { kind: "add-who" };
      return html(ctx, ASK_ADD_WHO, whoKeyboard());
    }
    const existing = notebook.activeAs(person);
    if (existing) {
      step = undefined;
      return html(ctx, activeCard(existing), new InlineKeyboard().text("📓 Тетрадочка", "list"));
    }
    if (!person.username && !person.name) {
      step = { kind: "add-name", person };
      return html(ctx, askName(person));
    }
    if (!reason) {
      step = { kind: "add-reason", person };
      return html(ctx, askAddReason(person));
    }
    if (reason.length > REASON_LIMIT) {
      step = { kind: "add-reason", person };
      return html(ctx, TOO_LONG);
    }
    step = undefined;
    const entry = notebook.add(person, reason);
    return html(
      ctx,
      addedCard(entry),
      new InlineKeyboard().text("📓 Тетрадочка", "list").text("➕ Ещё одного", "add"),
    );
  }

  const pickKeyboard = (entries: Entry[]) => {
    const kb = new InlineKeyboard();
    entries.slice(0, PICK_LIMIT).forEach((e, i) => {
      kb.text(plainLabel(e), `pick:${e.id}`);
      if (i % 2 === 1) kb.row();
    });
    return kb;
  };

  async function startRemove(ctx: Context, entry?: Entry, reason?: string) {
    if (!entry) {
      const active = notebook.list();
      if (active.length === 0) {
        step = undefined;
        return html(ctx, "Тетрадочка пуста, вычёркивать некого.", new InlineKeyboard().text("➕ Записать", "add"));
      }
      step = { kind: "remove-who" };
      const hint =
        active.length > PICK_LIMIT ? "\n\nВ кнопках не все — можно прислать логин, телефон или имя сообщением." : "";
      return html(ctx, `Кого вычёркиваем?${hint}`, pickKeyboard(active));
    }
    if (!notebook.get(entry.id)) {
      step = undefined;
      return html(ctx, notInNotebook(entry));
    }
    if (!reason) {
      step = { kind: "remove-reason", entry };
      return html(ctx, askRemoveReason(entry));
    }
    if (reason.length > REASON_LIMIT) {
      step = { kind: "remove-reason", entry };
      return html(ctx, TOO_LONG);
    }
    step = { kind: "remove-confirm", entry, reason };
    return html(
      ctx,
      `⚠️ Точно вычеркнуть ${label(entry)}?\n\nПричина: ${escape(reason)}`,
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
    return startAdd(ctx, username ? { kind: "telegram", username } : undefined, reason);
  });

  bot.command("remove", (ctx) => {
    const { first, username, reason } = parseArgs(ctx.match);
    if (first && !username) return html(ctx, NOT_A_LOGIN);
    if (!username) return startRemove(ctx);
    const entry = notebook.active(username);
    if (!entry) return html(ctx, notInNotebook({ kind: "telegram", username }));
    return startRemove(ctx, entry, reason);
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
      case "add-who": {
        if (text === NO_TELEGRAM) {
          step = { kind: "add-name", person: { kind: "offline" } };
          return html(ctx, ASK_NAME);
        }
        const username = parseUsername(text);
        if (username) return startAdd(ctx, { kind: "telegram", username });
        const phone = parsePhone(text);
        if (phone) return startAdd(ctx, { kind: "telegram", phone });
        return html(ctx, NOT_A_PERSON);
      }
      case "add-name":
        if (text.length > NAME_LIMIT) return html(ctx, NAME_TOO_LONG);
        return startAdd(ctx, { ...step.person, name: text });
      case "add-reason":
        return startAdd(ctx, step.person, text);
      case "remove-who": {
        const found = notebook.search(text);
        if (found.length === 0) return html(ctx, ASK_REMOVE_WHO);
        if (found.length === 1) return startRemove(ctx, found[0]);
        return html(ctx, "Таких несколько. Кого вычёркиваем?", pickKeyboard(found));
      }
      case "remove-reason":
        return startRemove(ctx, step.entry, text);
      default:
        step = undefined;
        return html(ctx, GREETING, menu());
    }
  });

  // A picked user or a shared contact starts the add dialog from any step.
  bot.on("message:users_shared", (ctx) => {
    const user = ctx.message.users_shared.users[0];
    if (!user) return startAdd(ctx);
    return startAdd(ctx, {
      kind: "telegram",
      userId: user.user_id,
      username: user.username,
      name: fullName(user.first_name, user.last_name),
    });
  });

  // A contact carries user_id only when the person has a Telegram account.
  bot.on("message:contact", (ctx) => {
    const c = ctx.message.contact;
    return startAdd(ctx, {
      kind: c.user_id ? "telegram" : "offline",
      userId: c.user_id,
      phone: parsePhone(c.phone_number) ?? c.phone_number,
      name: fullName(c.first_name, c.last_name),
    });
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

  bot.callbackQuery(/^pick:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const entry = notebook.get(Number(ctx.match[1]));
    if (!entry) return html(ctx, "Этого человека уже нет в тетрадочке.");
    await startRemove(ctx, entry);
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
    const entry = notebook.remove(pending.entry.id, pending.reason);
    if (!entry) return html(ctx, notInNotebook(pending.entry));
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
