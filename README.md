# wta-bot

Discord bot for the Western Tech Alumni mock-interview program. One Cloudflare
Worker serves the Discord interactions endpoint, the external form rail, and
the interviewer packet pages, backed by D1. See [DESIGN.md](DESIGN.md).

## Stack

- Cloudflare Workers (webhook interactions — no gateway) + D1 + cron triggers
- hono (routing + JSX-rendered form pages), TypeScript
- Cloudflare Email Service for email reminders (M5, opt-in per participant)

## Setup

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in (see below)
npm run migrate:local
npm run dev                      # http://localhost:8787/health
```

### Discord application (one-time)

1. <https://discord.com/developers/applications> → **New Application** → name it (e.g. `WTA`).
2. Copy **Application ID** and **Public Key** into `.dev.vars`.
3. **Bot** tab → **Reset Token** → copy into `.dev.vars`.
4. Create a private dev server; enable Developer Mode in Discord settings; right-click the server → **Copy Server ID** → `DEV_GUILD_ID`.
5. `npm run register` — registers the slash commands to the dev guild.
6. After deploying with secrets set, put `https://wta.hunterchen.ca/discord` in the app's **Interactions Endpoint URL** (Discord sends a PING to verify).
7. Invite the bot: OAuth2 → URL generator → scopes `bot` + `applications.commands`.

### Production secrets

```sh
wrangler secret put DISCORD_APP_ID
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_TOKEN
wrangler secret put FORM_SIGNING_SECRET   # openssl rand -hex 32
```

### Deploy

```sh
npm run migrate:remote   # apply migrations to the real D1
npm run deploy           # deploys + provisions wta.hunterchen.ca
```

## Milestones

M0 scaffold (this) → M1 intake → M2 opt-in/matching/threads → M3 form rail →
M4 incidents/repair → M5 problem bank + email → M6 polish. See DESIGN.md §11.
