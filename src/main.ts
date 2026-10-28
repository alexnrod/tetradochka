import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { COMMANDS, createBot } from "./bot.ts";
import { Notebook } from "./notebook.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const token = requireEnv("BOT_TOKEN");
const ownerId = Number(requireEnv("OWNER_ID"));
if (!Number.isInteger(ownerId)) throw new Error("OWNER_ID must be a numeric Telegram user ID");
const dbPath = requireEnv("DB_PATH");

mkdirSync(dirname(dbPath), { recursive: true });
const notebook = new Notebook(dbPath);
const bot = createBot(token, ownerId, notebook);

const stop = () => bot.stop();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

await bot.api.setMyCommands(COMMANDS);
// Long polling: the bot opens no ports. Messages sent during a deploy are processed after the restart.
await bot.start({
  onStart: (me) => console.log(`Started as @${me.username}`),
});
notebook.close();
