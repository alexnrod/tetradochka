import assert from "node:assert/strict";
import { test } from "node:test";
import type { Update } from "grammy/types";
import { createBot } from "./bot.ts";
import { Notebook } from "./notebook.ts";

const OWNER = 42;
const botInfo = {
  id: 1,
  is_bot: true as const,
  first_name: "Моя тетрадочка",
  username: "test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
};

type Call = { method: string; payload: any };

function setup() {
  const notebook = new Notebook(":memory:");
  const bot = createBot("token", OWNER, notebook, botInfo as any);
  const calls: Call[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: true } as any;
  });
  let id = 0;
  const chat = { id: OWNER, type: "private" as const, first_name: "Owner" };
  const from = { id: OWNER, is_bot: false, first_name: "Owner" };

  const send = (text: string, fromId = OWNER) => {
    const command = text.match(/^\/\w+/);
    const update: Update = {
      update_id: ++id,
      message: {
        message_id: id,
        date: 0,
        chat,
        from: { ...from, id: fromId },
        text,
        entities: command ? [{ type: "bot_command", offset: 0, length: command[0].length }] : undefined,
      },
    };
    return bot.handleUpdate(update);
  };
  const press = (data: string) =>
    bot.handleUpdate({
      update_id: ++id,
      callback_query: {
        id: String(id),
        from,
        chat_instance: "1",
        data,
        message: { message_id: 1, date: 0, chat, text: "" },
      },
    } as Update);
  const replies = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.payload);
  const lastReply = () => replies().at(-1);
  const buttons = (payload: any): string[] =>
    payload.reply_markup.inline_keyboard.flat().map((b: { callback_data: string }) => b.callback_data);

  return { notebook, send, press, calls, replies, lastReply, buttons };
}

test("add dialog asks for login and reason, then shows the card", async () => {
  const t = setup();
  await t.press("add");
  assert.match(t.lastReply().text, /Кого записываем/);
  await t.send("Иван Петров");
  assert.match(t.lastReply().text, /Не похоже на логин/);
  await t.send("@ivan_petrov");
  assert.match(t.lastReply().text, /Почему записываем <code>@ivan_petrov<\/code>/);
  await t.send("Обещал <вернуть> книгу");
  assert.match(t.lastReply().text, /Записано в тетрадочку/);
  assert.match(t.lastReply().text, /Обещал &lt;вернуть&gt; книгу/);
  assert.deepEqual(t.buttons(t.lastReply()), ["list", "add"]);
  assert.equal(t.notebook.active("ivan_petrov")?.addReason, "Обещал <вернуть> книгу");
});

test("one-line /add and an already active login", async () => {
  const t = setup();
  await t.send("/add @masha_k Позвала на день рождения");
  assert.ok(t.notebook.active("masha_k"));
  await t.send("/add @MASHA_K ещё раз");
  assert.match(t.lastReply().text, /уже в тетрадочке/);
});

test("remove dialog picks a login, asks the reason and confirms", async () => {
  const t = setup();
  t.notebook.add("masha_k", "Позвала на день рождения");
  t.notebook.add("olga_s", "Посоветовала врача");
  await t.send("/remove");
  assert.deepEqual(t.buttons(t.lastReply()), ["pick:masha_k", "pick:olga_s"]);
  await t.press("pick:masha_k");
  assert.match(t.lastReply().text, /За что вычёркиваем/);
  await t.send("Уже поздравил, вопрос закрыт");
  assert.match(t.lastReply().text, /Точно вычеркнуть/);
  const confirm = t.lastReply().reply_markup.inline_keyboard[0];
  assert.equal(confirm[1].style, "danger");
  assert.ok(t.notebook.active("masha_k"), "nothing is removed before confirmation");
  await t.press("confirm:yes");
  assert.match(t.lastReply().text, /<s>@masha_k<\/s> · вычеркнуто/);
  assert.equal(t.notebook.active("masha_k"), undefined);
  assert.equal(t.notebook.removed()[0].removeReason, "Уже поздравил, вопрос закрыт");
});

test("cancel keeps the person and a stale confirmation does nothing", async () => {
  const t = setup();
  t.notebook.add("olga_s", "Посоветовала врача");
  await t.send("/remove @olga_s передумал");
  await t.press("confirm:no");
  assert.ok(t.notebook.active("olga_s"));
  const sent = t.replies().length;
  await t.press("confirm:yes");
  assert.ok(t.notebook.active("olga_s"));
  assert.equal(t.replies().length, sent);
});

test("list pages through entries", async () => {
  const t = setup();
  for (let i = 0; i < 12; i++) t.notebook.add(`user_${String(i).padStart(2, "0")}`, `reason ${i}`);
  await t.send("/list");
  assert.match(t.lastReply().text, /12 человек/);
  assert.deepEqual(t.buttons(t.lastReply()), ["noop", "list:2", "add", "remove"]);
  await t.press("list:2");
  const edit = t.calls.filter((c) => c.method === "editMessageText").at(-1)!.payload;
  assert.match(edit.text, /11\. <code>@user_10<\/code>/);
});

test("history shows removed people with both reasons", async () => {
  const t = setup();
  t.notebook.add("masha_k", "Позвала на день рождения");
  t.notebook.remove("masha_k", "Уже поздравил");
  await t.send("/history");
  assert.match(t.lastReply().text, /Записали .*: Позвала на день рождения/);
  assert.match(t.lastReply().text, /Вычеркнули .*: Уже поздравил/);
});

test("strangers get no reply", async () => {
  const t = setup();
  await t.send("/start", 7);
  await t.send("/add @someone reason", 7);
  assert.equal(t.calls.length, 0);
  assert.equal(t.notebook.list().length, 0);
});
