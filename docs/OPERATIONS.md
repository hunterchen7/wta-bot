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
- The **threads channel** can be a text channel (private threads: only the
  pair + anyone with **Manage Threads** — give organizers that permission) or
  a **forum channel** (one post per pairing; visible to everyone who sees the
  forum — no privacy, but a tidy browsable board). The bot adapts automatically.
- **Server Members Intent** (dev portal) must be ON for `/verify backfill`.
- If the interactions endpoint ever shows as failing in the portal, the Worker
  is down or the public key changed — check `/health`, then secrets.

## Running a cohort

**One-time setup (organizer, in Discord):**

1. `/admin setup channels announce:#... organizer:#... threads:#... start_here:#... intros:#...`
2. `/admin setup roles member:@Member participant:@Participant organizer:@Organizer`
   (bot role must sit above these, with Manage Roles + Manage Nicknames on)
3. `/admin setup verify` → panel appears in #start-here; `/admin backfill` once
   (needs Server Members intent toggled on); then lock `@everyone` to #start-here.
4. Load the bank: `/admin problems add` per problem (solution notes pasted in the
   dashboard → Problems), then `/admin problems setweek 1..3`. Sets are **public**:
   `/bank` + the pairing announcement; interviewers record their pick on the
   report. (Private T-24h packets exist but are off — `settings.packet_mode`.)
5. `/admin setup cohort start_date:YYYY-MM-DD name:"Summer 2026"` — round 1's first
   day, any weekday (2026: `2026-07-26`). **That's the last manual step.** The
   cron runs everything else.

**The automated round (14 days, all Toronto time, D = round start):** D-3
16:00 opt-in opens (announce post + DMs) → D-2 18:00 reminder to
non-responders → D-1 18:00 close, 18:15 match (threads, pairing DMs/emails,
residuals → repair queue) → D+3 and D+10 18:00 unscheduled-session nudges →
packets to interviewers 24h before each session → report forms at session
time → T-24h form nudges, overdue sweeps → D+14 09:00 organizer digest. The
final round gets a +4-day repair/report grace window.
Mid-week no-shows: victims are re-paired automatically (complementary victims,
then standby volunteers); anything unrepaired simply becomes next week's
deficit and the demand math offers a catch-up double.

**Humans in the loop:** case files (strike 2) land in the organizer channel
with Remove / Excuse / Keep buttons; `/admin excuse @user` clears good-reason cases;
W3 pass verdicts wait in dashboard → Reviews for a recording **verify/flag**;
verify + 6/6 fires eligibility automatically.

**Admin reference:** everything under `/admin` (roster, export, standing,
excuse, pair, repair, participant, problems, digest, eligible, setup,
backfill) — plus the dashboard: `/dashboard` in Discord for a one-click
sign-in link, or `/login` with your roster email.

## Web dashboard

- Students and organizers log in at `/login` with their **roster email**
  (6-digit code, 10-min expiry). **Requires Email Service to be enabled** —
  until then codes are only visible in `wrangler tail` logs.
- Organizer views appear when the logged-in person holds the configured
  organizer role in Discord (checked at login; re-login after role changes).
- Sessions last 7 days; log out from the top nav.

## Costs

- Workers free tier covers the bot itself comfortably at cohort scale.
- Workers Paid (~$5/mo) becomes necessary at M5 for Email Service quota
  (3k emails/month included).
- Domain renewal (~$12/yr) is on the domain owner's account.
