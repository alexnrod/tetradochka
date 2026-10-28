# Моя тетрадочка

Private Telegram bot that keeps a list of people by their Telegram login. Each entry records when and why the person was added, and when and why they were removed. Only the owner (`OWNER_ID`) can use it; other users get no reply.

| Command | Action |
|---|---|
| `/add @login reason` | Add a person |
| `/remove @login reason` | Remove a person |
| `/list` | People currently in the notebook |
| `/show @login` | Full history of a person, including removals |

A removed person stays in the history and can be added again.

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
