# Deployment

The bot runs on the insurance-portal VM (`95.163.231.103`) as its own Docker Compose project in `/opt/tetradochka`. GitHub Actions builds the image and ships it over SSH, like insurance-portal.

| Item | Value |
|---|---|
| App directory | `/opt/tetradochka` |
| Compose file | `docker-compose-production.yml` |
| Database | `/data/tetradochka.db` in the `tetradochka_bot_data` volume |

## Pipeline

`.github/workflows/deploy.yml` runs on every push to `main` and on manual dispatch:

1. Runs `pnpm lint` and `pnpm test`.
2. Builds `tetradochka-bot:latest` and streams it to the VM with `docker save | gzip | ssh … docker load`.
3. Copies `docker-compose-production.yml` to `/opt/tetradochka/` and runs `docker compose up -d`.

Repository secrets are the same values as in insurance-portal:

```bash
gh secret set DEPLOY_HOST --body 95.163.231.103
gh secret set DEPLOY_SSH_KEY < ~/.ssh/insurance
ssh-keyscan -t ed25519 95.163.231.103 | gh secret set DEPLOY_KNOWN_HOSTS
```

## First-time setup

1. Create the bot in [@BotFather](https://t.me/BotFather) with `/newbot` and copy the token.
2. Get your numeric user ID from [@userinfobot](https://t.me/userinfobot).
3. Create the env file on the VM as root; the token never leaves the VM:

```bash
mkdir -p /opt/tetradochka
install -m 600 /dev/null /opt/tetradochka/.env
nano /opt/tetradochka/.env
```

```
BOT_TOKEN=<token from BotFather>
OWNER_ID=<your user ID>
TZ=Europe/Berlin
```

4. Trigger the first deploy with a push to `main` or `gh workflow run deploy.yml`.

## Operations

Run in `/opt/tetradochka`:

```bash
docker compose -f docker-compose-production.yml ps
docker compose -f docker-compose-production.yml logs bot -f
```

Back up the database:

```bash
docker compose -f docker-compose-production.yml stop bot
docker run --rm -v tetradochka_bot_data:/data -v /root:/backup alpine cp /data/tetradochka.db /backup/tetradochka-$(date +%F).db
docker compose -f docker-compose-production.yml start bot
```
