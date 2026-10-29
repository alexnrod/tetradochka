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

const login = (username: string) => ({ kind: "telegram" as const, username });

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

  const message = (fields: object, fromId = OWNER) =>
    bot.handleUpdate({
      update_id: ++id,
      message: { message_id: id, date: 0, chat, from: { ...from, id: fromId }, ...fields },
    } as Update);
  const send = (text: string, fromId = OWNER) => {
    const command = text.match(/^\/\w+/);
    const entities = command ? [{ type: "bot_command", offset: 0, length: command[0].length }] : undefined;
    return message({ text, entities }, fromId);
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

  return { notebook, message, send, press, calls, replies, lastReply, buttons };
}

test("add dialog asks for login and reason, then shows the card", async () => {
  const t = setup();
  await t.press("add");
  assert.match(t.lastReply().text, /Кого записываем/);
  assert.deepEqual(
    t.lastReply().reply_markup.keyboard.flat().map((b: { text: string }) => b.text),
    ["👤 Выбрать в Telegram", "✍️ Без Telegram"],
  );
  await t.send("Иван Петров");
  assert.match(t.lastReply().text, /Не похоже на логин или телефон/);
  await t.send("@ivan_petrov");
  assert.match(t.lastReply().text, /Почему записываем <code>@ivan_petrov<\/code>/);
  assert.deepEqual(t.lastReply().reply_markup, { remove_keyboard: true });
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
  t.notebook.add(login("masha_k"), "Позвала на день рождения");
  t.notebook.add(login("olga_s"), "Посоветовала врача");
  await t.send("/remove");
  assert.deepEqual(t.buttons(t.lastReply()), ["pick:1", "pick:2"]);
  await t.press("pick:1");
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
  t.notebook.add(login("olga_s"), "Посоветовала врача");
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
  for (let i = 0; i < 12; i++) t.notebook.add(login(`user_${String(i).padStart(2, "0")}`), `reason ${i}`);
  await t.send("/list");
  assert.match(t.lastReply().text, /12 человек/);
  assert.deepEqual(t.buttons(t.lastReply()), ["noop", "list:2", "add", "remove"]);
  await t.press("list:2");
  const edit = t.calls.filter((c) => c.method === "editMessageText").at(-1)!.payload;
  assert.match(edit.text, /11\. <code>@user_10<\/code>/);
});

test("history shows removed people with both reasons", async () => {
  const t = setup();
  const entry = t.notebook.add(login("masha_k"), "Позвала на день рождения");
  t.notebook.remove(entry.id, "Уже поздравил");
  await t.send("/history");
  assert.match(t.lastReply().text, /Записали .*: Позвала на день рождения/);
  assert.match(t.lastReply().text, /Вычеркнули .*: Уже поздравил/);
});

test("a user picked in Telegram is added with id, login and name", async () => {
  const t = setup();
  await t.press("add");
  await t.message({
    users_shared: { request_id: 1, users: [{ user_id: 555, first_name: "Иван", last_name: "Петров" }] },
  });
  assert.match(t.lastReply().text, /Почему записываем 👤 Иван Петров/);
  await t.send("Сосед");
  assert.match(t.lastReply().text, /Telegram без логина: Иван Петров/);
  assert.deepEqual(
    { ...t.notebook.activeAs({ kind: "telegram", userId: 555 }), addedAt: undefined },
    { id: 1, kind: "telegram", userId: 555, username: undefined, name: "Иван Петров", phone: undefined,
      addedAt: undefined, addReason: "Сосед", removedAt: null, removeReason: null, files: 0 },
  );
  await t.message({ users_shared: { request_id: 1, users: [{ user_id: 555, first_name: "Иван" }] } });
  assert.match(t.lastReply().text, /уже в тетрадочке/);
});

test("a phone asks for the name; a contact without Telegram is offline", async () => {
  const t = setup();
  await t.press("add");
  await t.send("8 916 123-45-67");
  assert.match(t.lastReply().text, /Как зовут человека с номером <code>\+79161234567<\/code>/);
  await t.send("Маша");
  await t.send("Соседка");
  assert.match(t.lastReply().text, /Телефон: <code>\+79161234567<\/code>/);
  assert.equal(t.notebook.list()[0].kind, "telegram");

  await t.message({ contact: { phone_number: "+491512345678", first_name: "Hans" } });
  await t.send("Коллега");
  assert.match(t.lastReply().text, /Без Telegram: Hans/);
  assert.equal(t.notebook.list()[1].kind, "offline");
});

test("a person without Telegram is added by name and removed by name", async () => {
  const t = setup();
  await t.press("add");
  await t.send("✍️ Без Telegram");
  assert.match(t.lastReply().text, /Как зовут/);
  await t.send("Иван Петров");
  await t.send("Сосед по даче");
  assert.match(t.lastReply().text, /Без Telegram: Иван Петров/);
  await t.send("/list");
  assert.match(t.lastReply().text, /1\. ✍️ Иван Петров ·/);

  await t.press("remove");
  assert.deepEqual(t.lastReply().reply_markup.inline_keyboard[0][0].text, "✍️ Иван Петров");
  await t.send("иван петров");
  assert.match(t.lastReply().text, /За что вычёркиваем ✍️ Иван Петров/);
  await t.send("Продал дачу");
  await t.press("confirm:yes");
  assert.match(t.lastReply().text, /<s>✍️ Иван Петров<\/s> · вычеркнуто/);
});

const photo = (fileId: string) => [{ file_id: `${fileId}_small`, file_unique_id: "s", width: 90, height: 90 },
  { file_id: fileId, file_unique_id: "l", width: 1280, height: 1280 }];

test("files sent before the reason are attached", async () => {
  const t = setup();
  await t.send("/add @masha_k");
  assert.match(t.lastReply().text, /Можно приложить фото, скриншот или файл/);
  await t.message({ photo: photo("p1") });
  assert.match(t.lastReply().text, /Приложил\. Теперь напиши, почему записываем <code>@masha_k<\/code>/);
  await t.message({ document: { file_id: "d1", file_unique_id: "d", file_name: "chat.pdf" } });
  await t.send("Переписка");
  assert.match(t.lastReply().text, /Записано в тетрадочку/);
  assert.deepEqual(t.buttons(t.lastReply()), ["files:1", "list", "add"]);
  assert.deepEqual(t.notebook.files(1), [{ type: "photo", fileId: "p1" }, { type: "document", fileId: "d1" }]);

  await t.press("files:1");
  assert.deepEqual(
    t.calls.slice(-2).map((c) => [c.method, c.payload.photo ?? c.payload.document, c.payload.caption]),
    [["sendPhoto", "p1", "📎 <code>@masha_k</code>"], ["sendDocument", "d1", undefined]],
  );
  await t.send("/list");
  assert.match(t.lastReply().text, /<a href="https:\/\/t\.me\/test_bot\?start=files_1">📎 2<\/a>/);
  await t.send("/start files_1");
  assert.equal(t.calls.filter((c) => c.method === "sendPhoto").length, 2);
});

test("an album caption is the reason and the whole album is attached", async () => {
  const t = setup();
  await t.send("/add @olga_s");
  await t.message({ photo: photo("a1"), media_group_id: "g" });
  await t.message({ photo: photo("a2"), media_group_id: "g", caption: "Скриншоты" });
  await t.message({ photo: photo("a3"), media_group_id: "g" });
  const replies = t.replies().map((r) => r.text);
  assert.equal(replies.filter((r) => /Приложил/.test(r)).length, 1);
  assert.match(replies.at(-1), /Почему: Скриншоты/);
  assert.deepEqual(t.notebook.files(1).map((f) => f.fileId), ["a1", "a2", "a3"]);
});

test("strangers get no reply", async () => {
  const t = setup();
  await t.send("/start", 7);
  await t.send("/add @someone reason", 7);
  assert.equal(t.calls.length, 0);
  assert.equal(t.notebook.list().length, 0);
});
