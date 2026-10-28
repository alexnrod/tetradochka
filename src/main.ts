import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { COMMANDS, DESCRIPTION, SHORT_DESCRIPTION, createBot, describeError } from "./bot.ts";
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

// bot.stop() confirms the last update offset with one more request, which may fail on a bad network.
let stopping = false;
const stop = async () => {
  stopping = true;
  await bot.stop().catch((err) => console.error("Stop failed:", describeError(err)));
  notebook.close();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

// Menu and description are cosmetic: a failed call must not keep the bot from polling.
Promise.all([
  bot.api.setMyCommands(COMMANDS),
  bot.api.setMyDescription(DESCRIPTION),
  bot.api.setMyShortDescription(SHORT_DESCRIPTION),
]).catch((err) => console.error("Bot profile update failed:", describeError(err)));

// Long polling: the bot opens no ports. Messages sent during a deploy are processed after the restart.
// grammY retries failed polls itself; if polling still dies, the process exits and Docker restarts the container.
try {
  await bot.start({
    onStart: (me) => console.log(`Started as @${me.username}`),
  });
} catch (err) {
  if (!stopping) {
    console.error("Bot stopped:", describeError(err));
    notebook.close();
    process.exit(1);
  }
}
