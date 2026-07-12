# Setup guide — from zero

For a future organizer/maintainer inheriting this bot. Following this top to
bottom gets you from a fresh laptop to a working deployment. If the bot is
already deployed and you just need to run it day-to-day, read
[OPERATIONS.md](OPERATIONS.md) instead. Architecture and product design live in
[DESIGN.md](../DESIGN.md).

The system is a single Cloudflare Worker (TypeScript) serving three things:
the Discord interactions endpoint (`POST /discord`), the external form pages
(`/f/<token>`, `/p/<token>`, `/export/<token>`), and a 15-minute cron tick.
Storage is Cloudflare D1 (SQLite). There is no server to maintain.

## 0. Access you need (ownership map)

| Thing | Where | Owner (2026 cohort) | Handoff notes |
|---|---|---|---|
| GitHub repo | `github.com/hunterchen7/wta-bot` (private) | hunterchen7 | Add next maintainer as collaborator, or transfer to an org |
| Cloudflare account | Worker `wta-bot`, D1 `wta-bot`, Workers Builds | hunter.chen7@pm.me (personal) | Worker + D1 would need re-creating under a new account; cheap (this guide) |
| Domain | `wta.hunterchen.ca` (zone `hunterchen.ca`) | Hunter (personal) | If the domain changes, update `routes` in `wrangler.jsonc` + Discord endpoint URL |
| Discord application | dev portal → "WTA" app | Hunter | Portal → App → transferable to a team; owns the bot token |
| Discord server | the WTA server | WTA admins | Bot must be re-invited if the app changes |
| Legacy Google account | `wtechalumni@gmail.com` (old forms) | WTA | Only needed for importing old data |

## 1. Local development

Prereqs: Node ≥ 24, npm, git.

```sh
git clone https://github.com/hunterchen7/wta-bot && cd wta-bot
npm install
cp .dev.vars.example .dev.vars      # fill in after §2
npm run migrate:local               # local D1 with full schema
npm run typecheck && npm test       # should be fully green before you change anything
npm run dev                         # http://localhost:8787 (pick another port if taken: npx wrangler dev --port 8799)
curl localhost:8787/health          # {"ok":true,"participants":0}
```

Rules of the road:
- All TypeScript, including scripts (they run on Node's native type-stripping).
- Every change lands with `npm run typecheck` + `npm test` green.
- Schema changes are always a **new** `migrations/000N_*.sql` file — never edit
  an applied migration.

## 2. Discord application (one-time per app)

1. <https://discord.com/developers/applications> → **New Application**.
2. **General Information**: copy **Application ID** and **Public Key**.
3. **Bot** tab → **Reset Token** → copy (this is `DISCORD_TOKEN`; treat like a password).
4. **Bot** tab settings:
   - **Public Bot: ON is fine.** The backend enforces a guild allowlist
     (`ALLOWED_GUILD_IDS`) — interactions from foreign servers are refused and
     the bot auto-leaves them.
   - **Privileged intents: all OFF.** This bot is webhook-only. Exception: flip
     **Server Members Intent ON** when you need `/verify backfill` (REST member
     list); it's instant under 10k users and harmless to leave on.
5. **Do NOT set the Interactions Endpoint URL yet** — Discord verifies it with
   a signed PING, which only succeeds after the Worker has its secrets (§3).
6. Invite URL: **OAuth2 → URL Generator** → scopes **`bot` +
   `applications.commands`** → bot permissions:
   View Channels, Send Messages, Create Public Threads, Create Private
   Threads, Send Messages in Threads, Manage Threads, Embed Links, Attach
   Files, Mention Everyone *(optional)*, Manage Roles *(optional — needed for
   the verification gate / participant roles; bot's role must sit above those
   roles in the server's role list)*.
   Open the generated URL and add the bot to your server(s).

## 3. Cloudflare

### D1 database (skip if it exists)

```sh
npx wrangler d1 create wta-bot
```

Put the returned `database_id` into `wrangler.jsonc` under `d1_databases`.

### Deploys — Workers Builds (token-free, recommended)

Dashboard → **Workers & Pages → Create → Import a repository** → pick the repo:

- Production branch: `main`
- Build command: `npm ci && npm run typecheck && npm test` ← failing tests block the deploy
- Deploy command: `npm run deploy:ci` (applies D1 migrations, then deploys)
- API token: "Create new token" (Cloudflare generates and holds it — nothing
  is stored in GitHub)

Every push to `main` now tests + migrates + deploys. GitHub Actions
(`.github/workflows/ci.yml`) runs the same checks on PRs; it needs no secrets.

### Custom domain

`wrangler.jsonc` → `routes: [{ pattern: "wta.hunterchen.ca", custom_domain: true }]`.
The zone must be on the same Cloudflare account; the first deploy provisions
DNS + certificate automatically. New domain = edit that line, push, then
update the Discord endpoint URL.

### Worker secrets & variables

Dashboard: Worker → **Settings → Variables & Secrets** (or `wrangler secret put NAME`):

| Name | Type | Value |
|---|---|---|
| `DISCORD_APP_ID` | secret | from §2 |
| `DISCORD_PUBLIC_KEY` | secret | from §2 |
| `DISCORD_TOKEN` | secret | from §2 |
| `FORM_SIGNING_SECRET` | secret | `openssl rand -hex 32` |
| `ALLOWED_GUILD_IDS` | plain var | comma-separated server IDs the bot serves |

Until secrets exist, `/discord` and `/f/*` return 503 by design; `/health`
works regardless.

### Email (M5+, optional until then)

Cloudflare **Email Service**: add the zone as a sending domain in the dash
(DKIM/SPF records are added automatically), choose the sender (e.g.
`wta@hunterchen.ca`), then uncomment the `send_email` binding in
`wrangler.jsonc`. Sending uses the Worker binding — no API keys. The included
3k emails/month requires the Workers Paid plan (~$5/mo).

## 4. Wire Discord to the Worker (order matters)

1. Secrets set (§3) and Worker deployed.
2. Dev portal → **General Information → Interactions Endpoint URL** =
   `https://wta.hunterchen.ca/discord` → Save. Discord PINGs it; the field
   turns green. If it errors: public key typo or secrets not deployed.
3. Register slash commands: fill `.dev.vars` (same values + `DEV_GUILD_ID` =
   your test server's ID) → `npm run register`. With `DEV_GUILD_ID` set,
   commands appear instantly in that one server; without it they register
   globally (up to ~1h propagation) — do that once things are stable.

## 5. Verify the install

- `https://wta.hunterchen.ca/health` → `{"ok":true,...}`
- `/join` in your server → three-modal intake walks through; `/health`
  participant count increments when you finish
- `/export` (as an admin) → CSV link that downloads
- `/join` from a server NOT in `ALLOWED_GUILD_IDS` → polite refusal + the bot
  leaves that server

## 6. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Endpoint URL won't verify | Wrong `DISCORD_PUBLIC_KEY`, secrets not deployed, or old deploy still live — check `wta.hunterchen.ca/health` first |
| Slash commands don't appear | `npm run register` not run, wrong `DEV_GUILD_ID`, or bot invited without the `applications.commands` scope — re-invite |
| Commands appear but error | Check Worker logs: `npx wrangler tail wta-bot` while reproducing |
| `/discord` returns 401 in logs | Signature mismatch — almost always a stale/wrong public key |
| CI deploy failing | Open the build in the dash (Worker → View builds); tests failing block deploys on purpose |
| `wrangler dev` port conflict | `npx wrangler dev --port 8799` |
| DB looks wrong | Inspect: `npx wrangler d1 execute wta-bot --remote --command "select ..."`; D1 Time Travel can restore to any point in the last 30 days |
