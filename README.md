# Моя тетрадочка

Private Telegram bot that keeps a list of people by their Telegram login. Each entry records when and why the person was added, and when and why they were removed. Only the owner (`OWNER_ID`) can use it; other users get no reply.

| Command | Action |
|---|---|
| `/start` | Greeting and main menu |
| `/add` | Add a person: the bot asks for the login and the reason |
| `/remove` | Remove a person: pick from buttons, give the reason, confirm |
| `/list` | People currently in the notebook, 10 per page |
| `/history` | Removed people with both reasons, newest first |

`/add @login reason` and `/remove @login reason` skip the questions. A removed person stays in the history and can be added again. Reasons are capped at 300 characters so a page fits into one Telegram message.

The look follows `design.html`. The avatar is `assets/avatar.jpg`, a 640×640 JPEG of `assets/icon.png` on white, set once through the Bot API:

```bash
curl -F 'photo={"type":"static","photo":"attach://avatar"}' -F avatar=@assets/avatar.jpg \
  "https://api.telegram.org/bot$BOT_TOKEN/setMyProfilePhoto"
```

The bot sets its commands and description on every start.

## Stack

- Node.js 24, TypeScript run directly by Node (type stripping, no build step)
- [grammY](https://grammy.dev) with long polling: the bot opens no ports
- SQLite via the built-in `node:sqlite`, one file in a Docker volume

## Development

```bash
corepack enable
pnpm install
cp .env.example .env   # fill BOT_TOKEN and OWNER_ID; use a separate test bot
pnpm start
pnpm lint && pnpm test
```

Telegram delivers updates of one bot to one poller only, so a local run with the production token steals updates from the VM.

Deployment: [docs/deployment.md](docs/deployment.md).
