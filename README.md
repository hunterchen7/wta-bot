# wta-bot

Discord bot for the Western Tech Alumni mock-interview program. One Cloudflare
Worker serves the Discord interactions endpoint, the external form rail, and
the interviewer packet pages, backed by D1.

**Docs:** [DESIGN.md](DESIGN.md) (what & why) ·
[docs/SETUP.md](docs/SETUP.md) (from-zero install: Discord app, Cloudflare,
local dev, troubleshooting) · [docs/OPERATIONS.md](docs/OPERATIONS.md)
(runbook: deploys, secrets, data, recovery).

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

Production deploys run on **Cloudflare Workers Builds** (token-free — Cloudflare
manages its own deploy credentials). One-time setup in the dashboard:
**Workers & Pages → Create → Import a repository → `hunterchen7/wta-bot`**, then:

- Production branch: `main`
- Build command: `npm ci && npm run typecheck && npm test`  ← failing tests block the deploy
- Deploy command: `npm run deploy:ci`  (applies D1 migrations, then deploys)

GitHub Actions (`.github/workflows/ci.yml`) additionally runs the same checks
on every push/PR — no secrets needed. Local `npm run deploy` also works via
wrangler's OAuth login for one-off manual deploys.

Schema changes always go in a NEW `migrations/000N_*.sql` file — never edit an
applied migration.

## Commands

**Everyone:** `/help` (this list, in Discord) · `/join` — enroll or edit your
profile · `/status` — progress, sessions, owed forms · `/optout` — sit out the
current round · `/cancel` — cancel a session with notice · `/report
no-show|unresponsive|issue` — problems, straight to the pipeline/organizers.

**Organizers** (Manage Server or the Organizer role): `/setup
channels|roles|cohort|verify` · `/verify backfill` · `/problems
add|list|setweek` · `/roster` · `/export` · `/standing @user` · `/excuse
@user` · `/participant hold|release|remove @user` · `/digest` · `/eligible`.

**Buttons:** round opt-in (in / double / standby / out) · session threads
(Scheduled ✅ / Can't make it / Report no-show) · Verify panel · case files
(Remove / Excuse / Keep) · packet swap.

**Web:** `/login` (email code) → dashboard; organizers also get Roster, Round
board, Reviews, Problems. `/preview` renders every web form read-only.

## Where to edit what

| Thing | File |
|---|---|
| `/join` intake modals + edit menu | `src/intake.ts` |
| Report form fields (both templates) | `src/forms/schema.ts` |
| Verify-gate modal | `src/handlers/components.ts` |
| Slash-command definitions | `src/discord/commands.ts` (self-syncs to Discord on deploy) |
| Bot messages (opt-in, pairings, nudges) | `src/engine/cycle.ts` |
| Email sender/content | `src/email.ts` + call sites |
| Web pages (forms, dashboard, previews) | `src/routes/forms.ts`, `src/routes/web.ts` |
| Round calendar anchors | `src/engine/weeks.ts` |

## Milestones

M0 scaffold (this) → M1 intake → M2 opt-in/matching/threads → M3 form rail →
M4 incidents/repair → M5 problem bank + email → M6 polish. See DESIGN.md §11.
