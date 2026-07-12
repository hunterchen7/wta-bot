# Operations runbook

Day-to-day reference for organizers/maintainers of a deployed bot. For
first-time installation see [SETUP.md](SETUP.md); for design rationale see
[DESIGN.md](../DESIGN.md).

## Deploying changes

- **Normal path:** merge/push to `main`. Workers Builds runs
  `typecheck + tests` (red = no deploy), applies D1 migrations, deploys.
  Watch it: dashboard → Worker `wta-bot` → **View builds**.
- **One-off manual deploy:** `npm run deploy` locally (uses wrangler's OAuth
  login). Avoid making a habit of it — CI is the source of truth.
- **Logs, live:** `npx wrangler tail wta-bot` while reproducing an issue.
- **Migrations:** new file per change (`migrations/000N_name.sql`); applied
  automatically by `deploy:ci`. Never edit an applied migration. Local dev DB:
  `npm run migrate:local`.

## Secrets

Live in the Worker (Settings → Variables & Secrets), never in git:
`DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_TOKEN`,
`FORM_SIGNING_SECRET`; plain var `ALLOWED_GUILD_IDS`.

- **Rotate the bot token** (annual handoff or suspected leak): dev portal →
  Bot → Reset Token → `npx wrangler secret put DISCORD_TOKEN` → done. No
  redeploy needed; takes effect immediately. Update `.dev.vars` too.
- **Rotating `FORM_SIGNING_SECRET`** invalidates all outstanding form/export
  links; the bot re-issues on the next reminder sweep — do it between weeks
  if possible.

## Guild allowlist (public app, private program)

`ALLOWED_GUILD_IDS` (comma-separated). Interactions from any other server get
an ephemeral refusal, write nothing, and the bot auto-leaves that server. DMs
always work. Add/remove ids in the dash var and it applies on the next
interaction — no deploy.

## Data

- Everything is in D1 database `wta-bot` (schema: [DESIGN.md §9](../DESIGN.md)
  and `migrations/`).
- **Roster export:** `/export` in Discord (organizers only) → 10-minute CSV
  link.
- **Ad-hoc queries:**
  `npx wrangler d1 execute wta-bot --remote --command "select count(*) from participants"`
- **Disaster recovery:** D1 Time Travel restores to any point in the last 30
  days: `npx wrangler d1 time-travel restore wta-bot --timestamp=...`. Do a
  `time-travel info` first.

## Discord-side settings that matter

- Bot role must sit **above** the Member/Participant roles (role granting).
- **Server Members Intent** (dev portal) must be ON for `/verify backfill`.
- If the interactions endpoint ever shows as failing in the portal, the Worker
  is down or the public key changed — check `/health`, then secrets.

## Weekly cohort operations

> Placeholder — this section fills in as M2–M6 land. It will cover: opening a
> cohort and setting week anchors, the opt-in → matching → announcement cycle,
> repairing broken sessions, the no-show case-file buttons, the W3 review
> queue, and the weekly digest. Admin command reference: DESIGN.md §8.

## Costs

- Workers free tier covers the bot itself comfortably at cohort scale.
- Workers Paid (~$5/mo) becomes necessary at M5 for Email Service quota
  (3k emails/month included).
- Domain renewal (~$12/yr) is on the domain owner's account.
