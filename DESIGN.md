# WTA Bot — Design

Discord bot for the Western Tech Alumni mock-interview program. Replaces the old flow (Google Form intake, script-generated pairings, per-week cloned feedback forms, manual chasing) with a single system that owns intake, weekly opt-in, pairing, scheduling nudges, no-show handling, post-interview reports, the problem bank, and progress tracking.

Items marked **[OPEN]** are defaults awaiting Hunter's confirmation. Everything else was decided in planning (2026-07-11).

## 1. Program model

- A **cohort** runs 3 **rounds of 14 days each** (2026: R1 Jul 26–Aug 8, R2 Aug 9–22, R3 Aug 23–Sep 5 — rounds start Sundays; applications close Jul 23). Each **participant** targets 6 sessions: 3 as interviewer + 3 as interviewee, one of each per round. Rows in the `weeks` table are rounds; `idx` = round number.
- A **session** is one directed interview: `interviewer → interviewee`. Weekly matching gives every active participant two *different* partners (one per role). Your interviewer and your interviewee in the same week are never the same person, and you never meet the same counterpart twice in a cohort (either direction, repairs included).
- Missed weeks are made up by **doubling**: per-role deficits are tracked, and weekly demand per role is `min(1 + deficit, 2)`.
- **Alumni-round eligibility** = 6/6 sessions completed and an organizer-approved final-round review. The review queue provides the recording and verify/flag actions; the interviewer form keeps the original question-level rubric and does not ask for a fabricated overall pass/fail verdict. Scheduling with actual alumni stays manual in v1. **[OPEN — confirm scope]**
- Roles: **Member** (verified human — see §14), **Participant** (enrolled student), **Organizer** (Discord role, gets admin commands + digest channel). Alumni-facing features are v2.

## 2. Round lifecycle (14 days)

All times America/Toronto, anchored to the round's start day D (any weekday — 2026 uses Sundays). Two mid-round nudges (D+3, D+10); reports due D+13 23:59; digest D+14; final round +4d grace. Recording reviews happen after every round (dashboard → Reviews); the eligibility gate remains the final round. Legacy weekly table below kept for anchor-hour reference:

| When | What |
|---|---|
| Fri 12:00 | Opt-in opens: channel post with **I'm in** / **standby** / **double** buttons + DM (email to DM-blocked) |
| Sat 18:00 | Reminder to enrolled non-responders |
| Sun 18:00 | Opt-in closes. Silence = sitting out (no penalty, deficit accrues) |
| Sun 19:00 | Matching runs. Pairings announced; one private thread per session (fallback: public thread in a members-only channel if private threads unavailable) |
| Mon–Sun | Sessions happen. Partners agree on a time in-thread → **Scheduled ✅** button (datetime via modal) |
| Wed 18:00 | Nudge threads with no confirmed time; **partner unresponsive** flag becomes available |
| T−24h | Interviewer packet delivered (problem + solution + hint ladder, signed page) |
| Session start | Both signed report-form links dropped in thread + DM'd |
| Sun 23:59 | Reports due **[OPEN — vs 48h after session]** |
| Mon 09:00 | Admin digest: completed / unscheduled / no-shows / overdue forms / behind-pace. Unrepaired breakage converts to next-week deficits |

Week 3 gets a **repair-only grace window** (default: +4 days for repairs and late reports; no new regular matching). **[OPEN]**

## 3. Matching

- **Pool:** everyone opted in, minus holds/paused/removed.
- **Hard constraints:** no self-pairing; no repeat counterpart within the cohort (either direction); within-week interviewer ≠ interviewee; respect holds.
- **Soft preferences (weighted, relaxed on failure):** similar experience band (from intake: # prior technical interviews), intern/new-grad alignment. **[OPEN — confirm these matter; random otherwise]**
- **Algorithm:** randomized greedy over the demand multigraph with retry/backoff (pool ≤ 200 — compute is trivial). Residual unmatchable demand seeds the repair queue and is reported in the digest.
- **Repair queue (mid-week):** every broken session enters typed by what's missing (`need-interviewer` / `need-interviewee`). Complementary victims are matched automatically on arrival; **standby volunteers** (opt-in checkbox) fill the rest. End-of-week leftovers convert to next-week deficits.

## 4. No-shows and strikes

Three incident kinds are tracked distinctly: **ghost** (confirmed time, didn't show), **unresponsive** (never scheduled despite nudges), and **late cancel** (frees the partner immediately and is recorded as softer). Every operational report has two equivalent entry points feeding the same incident pipeline: the **thread buttons**, and **slash commands** (`/report no-show|unresponsive`, `/cancel`) usable anywhere including DMs with the bot. Run outside a session thread, the bot asks which active session it concerns. General questions and concerns are intentionally not collected or tracked by the bot: participants use their session thread or DM an organizer directly. The accused is DM'd with a dispute button; disputes go to organizers.

- **Strike 1:** automatic — warning DM (with "reply with context"), incident logged, partner enters repair queue. The striker is rescheduled next week per policy.
- **Strike 2:** *no auto-removal.* Bot posts a case file to the admin channel (both incidents, dates, kinds, partner reports, any defense) with buttons **Remove / Excuse incident / Warn & keep**. Default: participant is **held** out of matching until an organizer clicks. **[OPEN — confirm hold-pending-review]**
- `/excuse` wipes or downgrades an incident at any time ("good reason" cases).
- **Credit rules:** a no-showed session counts for nobody; victims get priority repair, not free credit. Your session credit requires *your own* report filed — a partner's laziness never blocks your progress.

## 5. Forms

**Intake — web app launched from Discord** (`/join`):
- `/join` returns a short-lived signed link tied to the invoking Discord user and guild.
- The React enrollment form collects identity, program, opportunities, experience, topics, optional context, and email-reminder opt-in in one save-all flow.
- Re-running `/join` opens the same prefilled form for self-serve edits. The latest Discord username is persisted beside the immutable Discord user ID so dashboard and Discord identities remain reconcilable.
- **Nickname sync:** on name entry (and edits), the bot sets the member's server nickname to their entered name (truncated to 32). Fire-and-forget — never blocks intake. Needs **Manage Nicknames** + role hierarchy; Discord never allows changing the guild *owner's* nickname.

**External form rail** — for anything richer than a modal (post-interview reports with code paste; later: alumni pages, availability grids):
- One **template per form kind**, versioned: `interviewee_report`, `interviewer_report` **[OPEN — interviewer form fields pending access/paste]**, future kinds. "Week N" is a column, not a new form.
- Each session spawns two **form instances** (one per side) at session start. Instance = `(kind, session, assignee, deadline, token, payload)`.
- **Tokens:** HMAC-signed `instance_id + expiry`; the instance row is the source of truth (single-use semantics enforced server-side). The rendered page greets by name and shows full session context — no identity questions, no attendance-of-record questions duplicated from thread buttons (form keeps one attendance cross-check; mismatch between the two sides' reports auto-flags).
- **Interviewee report keeps:** attendance cross-check, cameras, ratings (experience / interviewer communication / preparedness), language, duration, organizer-only note, partner-visible feedback, required code paste, and the **session recording link** (recordings were required last year; v1 = paste a link, since Zoom/Meet recordings already live in the cloud — direct upload to R2 is a later option **[OPEN — where do recordings live today, and who uploads: interviewee or interviewer?]**). Question-used is auto-known. Attestation replaced by a submit-confirmation screen.
- **Interviewer report uses the original question-level technical and behavioural rubric.** It does not add an overall pass/fail verdict. Every final-round session enters the organizer review queue.
- **Relay:** partner-visible feedback is DM'd to the partner once both reports are in, or at the deadline, whichever first. Organizer-only notes never relay.
- **Reminder ladder per instance:** issued (thread + DM) → T−24h nudge if unfiled → overdue DM + digest line. `/status` lists owed forms with links.

## 6. Problem bank

- Problems: LeetCode-derived, stored with number, title, link, stripped statement, solution, hint ladder, and **difficulty** (plus a finer `difficulty_rank` for "harder medium / easier hard" grading).
- **Difficulty progression:** week 1 = easy, week 2 = medium, week 3 = harder mediums / easier hards. Weekly sets are **pre-generated from the master list** by difficulty rule (excluding already-used problems); admins can regenerate or swap individual problems. Recommended set size 4–6 **[OPEN — size; also where do last year's materials live? Drive import?]**.
- **Week-3 variance guard:** last year W3 problems varied too much in difficulty — unacceptable for the qualifying week. The W3 generator enforces a tight `difficulty_rank` band (e.g. all picks within ±0.2), the set gets a mandatory admin sign-off before the week opens, and the digest reports pass-rate per problem so a rogue-hard problem is visible immediately.
- **Bank page:** the week's set is served as a page on the same web rail (per-person signed link, same token mechanics as forms) — who receives the link (all participants vs interviewers only) is the visibility knob below.
- **Visibility change from last year:** week's *topics* are public for study guidance **[OPEN]**; actual problems are private. The interviewer gets the packet at **T−24h** via signed page.
- **Assignment:** bot proposes a problem filtered by the **exposure ledger** — the interviewee has never received it *or conducted it* (covers returning participants and reused banks). Interviewer can swap via buttons to another eligible problem **[OPEN — or fully free choice]**; final pick recorded automatically.
- After the interviewee's report lands, they're DM'd the solution page.

## 7. Notifications

| Event | Thread | DM | Email |
|---|---|---|---|
| Opt-in open/close reminder | channel | ✓ | non-responders only |
| Weekly pairing | ✓ | ✓ | ✓ |
| Scheduling nudge | ✓ | ✓ | — |
| Interviewer packet | — | ✓ | — |
| Report links (session start) | ✓ | ✓ | — |
| Form overdue | — | ✓ | ✓ |
| Strike / case notices | — | ✓ | ✓ |
| 6/6 completion / eligibility | — | ✓ | ✓ |

- **Email is opt-in** (`email_ok`, set at intake, editable via `/join` re-run): the email column above applies only to opted-in participants. Two exceptions always send regardless: the DM-failure fallback (time-sensitive session logistics when DMs are blocked) and strike/case notices (consequential enough to warrant it). Someone who opts out *and* blocks DMs surfaces as **unreachable** in the admin digest and gets channel pings only.
- DM failure (user blocks server DMs) → automatic email + channel ping fallback, logged.
- **Email:** Cloudflare Email Service (public beta since 2026-04) via Workers binding, sending from Hunter's existing domain on his personal CF account (sender address **[OPEN — e.g. `wta@<domain>`]**). Wrapped in an `EmailSender` interface so Resend/SES is a one-file swap if the beta shifts. Volume ≈ well under the 3k/mo included in Workers Paid.

## 8. Command surface

**Participants:** `/join` (intake/edit) · `/status` (progress 3+3, this week's sessions, owed forms with links, strikes) · `/report no-show|unresponsive|issue` · `/cancel` (can't make my session) · opt-in buttons (in / standby / double) · thread buttons: Scheduled ✅ · Can't make it · Report no-show · `/optout` (skip this week). Commands work in DMs with the bot; session context is inferred from the thread or asked via a select.

**Organizers:** `/week open|close|match|announce` (manual overrides of cron) · `/pair @a @b` · `/repair @user need:<role>` · `/excuse @user` · `/hold @user` / `/release @user` · `/remove @user` · `/standing @user` · `/eligible` · `/problems add|set-week|list` · `/export` (CSV: roster + progress + incidents) · `/digest now` · case-file buttons (Remove / Excuse / Warn & keep).

## 9. Data model (D1)

`participants` (discord_id, intake fields, status: active/paused/held/removed/completed, email_ok) · `cohorts` / `weeks` (schedule timestamps per week) · `optins` (week, participant, standby, double) · `sessions` (week, interviewer, interviewee, thread_id, state: pending_schedule/scheduled/completed/broken/cancelled, scheduled_at, problem_id, origin: match/repair/manual) · `form_instances` (kind, session, assignee, token_hash, deadline_at, submitted_at, payload JSON, reminder_state) · `incidents` (session, accused, reporter, kind, state: open/confirmed/excused, notes) · `repair_queue` (week, participant, need, state) · `problems` + `week_problem_sets` + `exposures` (participant, problem, role, session) · `notify_log` (participant, channel, kind, ref, status) · `settings` (knobs).

## 10. Architecture

One TypeScript **Cloudflare Worker** on Hunter's personal account:

- `POST /discord` — interactions endpoint (ed25519 verify; discord-hono or equivalent). Slash commands, buttons, modals. Deferred responses for anything slow (matching).
- `/f/:token`, `/p/:token`, `/login`, `/bank`, `/preview/*`, and `/app/*` are React/Tailwind routes served from the Worker asset binding. Their `/api/*` endpoints verify HMAC/expiry/session state, validate on the server, write D1, and trigger side effects. Re-edits remain allowed until the deadline; last write wins. No server-rendered HTML templates remain.
- **Cron triggers** — opt-in open/close, matching, nudge sweeps, packet delivery (T−24h scan), session-start form drops, deadline/overdue sweeps, digests, DM-failure email retries.
- **Bindings:** D1 (db), Email Service (send), secrets: `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `APP_ID`, `FORM_SIGNING_SECRET`.
- Outbound Discord REST for DMs/threads/announcements (paced against rate limits; ≤200 participants is comfortable).
- **Public app, private program:** the Discord app stays public (Hunter's call — avoids install-link friction); the backend enforces an `ALLOWED_GUILD_IDS` allowlist. Interactions from foreign guilds get an ephemeral refusal, write nothing, and the bot auto-leaves that guild. DMs and endpoint PINGs are unaffected. Unset allowlist = allow (pre-setup only).
- Command registration script run on deploy. Local dev via `wrangler dev` + a dev guild.
- **All TypeScript** — including ops scripts (run directly with Node ≥23 type-stripping; no `.mjs`).
- **Testing:** vitest + `@cloudflare/vitest-pool-workers` — tests execute inside the real Workers runtime against a real D1 with migrations applied. Every milestone lands with `npm run typecheck` and `npm test` green; work is committed in small chunks.
- Custom domain route on Hunter's existing zone **[OPEN — which domain/subdomain]**.

## 11. Milestones

1. **M0** — scaffold: Worker + D1 migrations + interactions verify + command registration + dev guild.
2. **M1** — intake (`/join` modals, roster, `/export`).
3. **M2** — weeks, opt-in flow, matching, threads, announcements, `/status`.
4. **M3** — form rail: tokens, interviewee/interviewer report templates, deadlines, reminder ladder, relay.
5. **M4** — incidents: buttons, strikes, case files, holds, repair queue, standby.
6. **M5** — problem bank: import, weekly sets, exposure ledger, packets, solution release; email channel + fallbacks.
7. **M6** — polish: digests, grace window, eligibility flow (final-round **review queue** with approve/flag buttons), admin overrides end-to-end.
8. **M7 (deliberately last)** — AI-assisted W3 review triage; see §13.

Deadline pending **[OPEN — cohort start date]**; M0–M2 before intake opens, M3–M4 before week 1, M5–M6 before week 2 at the latest.

## 12. Deployment (CI/CD)

- **Cloudflare Workers Builds** (native git integration) owns production deploys: on push to `main` it runs the build command (`npm ci && npm run typecheck && npm test` — failures block deploy) then the deploy command (`npm run deploy:ci` = D1 migrations + `wrangler deploy`). **Token-free**: Cloudflare auto-generates and holds its own deploy credential; nothing is stored in GitHub. Connected by Hunter in the dashboard (OAuth grant is his to make).
- **GitHub Actions** runs the same typecheck + test suite on every push/PR as an independent check — zero secrets. (An Actions-based deploy with a `CLOUDFLARE_API_TOKEN` secret — scopes: Workers Scripts:Edit + D1:Edit + the zone — remains the documented fallback; it lives in git history.)
- `account_id` pinned in `wrangler.jsonc`. Local `wrangler dev` / `npm test` unchanged; `npm run deploy` still works locally via wrangler OAuth for one-offs.

## 13. AI-assisted W3 review (M7 sketch — build last)

Replaces most organizer video-watching with automated triage; humans keep the final call.

- **Input:** the W3 recording link + both reports + the assigned problem/solution.
- **Pipeline (cron-driven):** fetch audio → speech-to-text with timestamps (Workers AI Whisper, or provider transcripts where Zoom/Meet supply them) → LLM scores the timed transcript against a rubric: interview actually happened end-to-end (duration, two speakers, intro/coding/wrap arc), assigned problem was used, candidate drove the solution, hint frequency/dependency, reading-the-solution or coaching red flags; cross-checked against form data (duration bucket, question id, code paste vs. known solution similarity).
- **Output:** score + confidence + timestamped flags ("check 12:30–14:00"). High-confidence passes auto-clear; everything else lands in the §11 review queue marked **suspicious** with pointers, so organizers watch minutes, not hours.
- **Principles:** the AI never fails anyone — it only clears or escalates to humans; every auto-clear is logged and spot-checkable; rubric and thresholds live in `settings`.

## 14. Discord verification

Server entry uses Discord's native verification level, Rules Screening, and AutoMod. The bot does not maintain a parallel verification panel, Member role, intro form, or backfill job. `/join` remains the separate WTA program enrollment gate and grants only the Participant role after the signed web form is completed.

## 15. Web dashboard & auth (built)

- **Login:** roster email → 6-digit OTP (hashed in `login_codes`, 10-min
  expiry, 5 attempts, 3 codes/15 min, no account enumeration) sent from the
  notification sender → signed HttpOnly cookie (7 days, SameSite=Lax).
- **Students:** progress bars, session list, owed reports (signed links), strikes.
- **Organizers** (Discord organizer role, checked at login): roster, week
  board, **W3 recording review queue** (verify → eligibility fires; flag →
  organizer-channel ping), and the **problem editor** (statement / hint ladder /
  solution) that feeds interviewer packets and post-report solution releases.
- Writes stay behind organizer sessions; students never see admin surfaces.

## 16. Open knobs (recap)

1. Weekly schedule anchors (which days) + report deadline style (end-of-week vs 48h-after).
2. Both reports required — confirmed? (Design assumes yes.)
3. Hold-pending-review after strike 2 — default on.
4. Week-3 grace window — default +4 days, repair/reports only.
5. Alumni round v1 = eligibility tracking only.
6. Matching soft preferences (experience band, intern/new-grad) — or pure random.
7. Problem set size (rec 4–6), topics-public compromise, auto-suggest-with-swap vs free choice, location of last year's materials.
8. Interviewer form fields (need access or paste).
9. ~~Domain/subdomain + sender address~~ — settled: `wta.hunterchen.ca`, mail from `wta@hunterchen.ca`.
10. Cohort start date → milestone dates.
11. Recordings: where they live today (Zoom/Meet/Drive?), link-paste vs R2 direct upload, and who owns the upload (interviewee or interviewer).
12. W3 variance band width (default ±0.2 rank) + whether non-W3 weeks also need admin sign-off on generated sets.
