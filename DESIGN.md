# WTA Bot — Design

Discord bot for the Western Tech Alumni mock-interview program. Replaces the old flow (Google Form intake, script-generated pairings, per-week cloned feedback forms, manual chasing) with a single system that owns intake, weekly opt-in, pairing, scheduling nudges, no-show handling, post-interview reports, the problem bank, and progress tracking.

Items marked **[OPEN]** are defaults awaiting Hunter's confirmation. Everything else was decided in planning (2026-07-11).

## 1. Program model

- A **cohort** runs 3 weeks. Each **participant** targets 6 sessions: 3 as interviewer + 3 as interviewee, normally one of each per week.
- A **session** is one directed interview: `interviewer → interviewee`. Weekly matching gives every active participant two *different* partners (one per role). Your interviewer and your interviewee in the same week are never the same person, and you never meet the same counterpart twice in a cohort (either direction, repairs included).
- Missed weeks are made up by **doubling**: per-role deficits are tracked, and weekly demand per role is `min(1 + deficit, 2)`.
- Completing 6/6 with clean reports flags the participant **alumni-round eligible**. v1 tracks eligibility and notifies organizers; scheduling with actual alumni stays manual. **[OPEN — confirm scope]**
- Roles: **Participant** (enrolled student), **Organizer** (Discord role, gets admin commands + digest channel). Alumni-facing features are v2.

## 2. Weekly lifecycle

All times America/Toronto. Default schedule **[OPEN — align to your real cadence]**:

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

Three incident kinds, tracked distinctly: **ghost** (confirmed time, didn't show), **unresponsive** (never scheduled despite nudges), **late cancel** (frees partner immediately, recorded as softer). Every report has two equivalent entry points feeding the same incident pipeline: the **thread buttons**, and **slash commands** (`/report no-show|unresponsive`, `/cancel`) usable anywhere including DMs with the bot — run outside a session thread, the bot asks which of your active sessions it's about via a select. `/report issue <text>` is a general private line to organizers (conduct problems, anything that doesn't fit a category). Prefix commands (`!ghost`) aren't possible in the webhook-only architecture — no message-content access — slash commands are the equivalent. The accused is DM'd with a dispute button; disputes go to organizers.

- **Strike 1:** automatic — warning DM (with "reply with context"), incident logged, partner enters repair queue. The striker is rescheduled next week per policy.
- **Strike 2:** *no auto-removal.* Bot posts a case file to the admin channel (both incidents, dates, kinds, partner reports, any defense) with buttons **Remove / Excuse incident / Warn & keep**. Default: participant is **held** out of matching until an organizer clicks. **[OPEN — confirm hold-pending-review]**
- `/excuse` wipes or downgrades an incident at any time ("good reason" cases).
- **Credit rules:** a no-showed session counts for nobody; victims get priority repair, not free credit. Your session credit requires *your own* report filed — a partner's laziness never blocks your progress.

## 5. Forms

**Intake — native Discord** (`/join` or a Join button):
- Modal 1: name, preferred email, Western email, dream-company blurb, year.
- Modal 2 (via Continue button): program, opportunities (intern/new-grad), prior WTA, # technical interviews, topics (checkboxes), email-reminders opt-in (checkbox, default off → `email_ok`).
- Optional modal 3 behind "add more": open-ended interests, prior-year feedback.
- Re-running `/join` prefills current answers (self-serve edits). Discord username + "I joined the Discord" fields are obsolete — identity comes from the interaction.

**External form rail** — for anything richer than a modal (post-interview reports with code paste; later: alumni pages, availability grids):
- One **template per form kind**, versioned: `interviewee_report`, `interviewer_report` **[OPEN — interviewer form fields pending access/paste]**, future kinds. "Week N" is a column, not a new form.
- Each session spawns two **form instances** (one per side) at session start. Instance = `(kind, session, assignee, deadline, token, payload)`.
- **Tokens:** HMAC-signed `instance_id + expiry`; the instance row is the source of truth (single-use semantics enforced server-side). The rendered page greets by name and shows full session context — no identity questions, no attendance-of-record questions duplicated from thread buttons (form keeps one attendance cross-check; mismatch between the two sides' reports auto-flags).
- **Interviewee report keeps:** attendance cross-check, cameras, ratings (experience / interviewer communication / preparedness), language, duration, organizer-only note, partner-visible feedback, required code paste. Question-used is auto-known. Attestation replaced by a submit-confirmation screen.
- **Relay:** partner-visible feedback is DM'd to the partner once both reports are in, or at the deadline, whichever first. Organizer-only notes never relay.
- **Reminder ladder per instance:** issued (thread + DM) → T−24h nudge if unfiled → overdue DM + digest line. `/status` lists owed forms with links.

## 6. Problem bank

- Problems: LeetCode-derived, stored with number, title, link, stripped statement, solution, hint ladder, and **difficulty** (plus a finer `difficulty_rank` for "harder medium / easier hard" grading).
- **Difficulty progression:** week 1 = easy, week 2 = medium, week 3 = harder mediums / easier hards. Weekly sets are **pre-generated from the master list** by difficulty rule (excluding already-used problems); admins can regenerate or swap individual problems. Recommended set size 4–6 **[OPEN — size; also where do last year's materials live? Drive import?]**.
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
- `GET|POST /f/:token` — form rail (render + submit). `GET /p/:token` — interviewer packet pages. Forms are server-rendered HTML from the same Worker (hono JSX templates, shared CSS, mobile-first) — no separate Pages project, no client framework, no build pipeline. Token → verify HMAC/expiry/instance state → render prefilled → POST → validate server-side → write `form_instances` in D1 → side effects fire inline (confirmation DM, credit update, relay check). Re-edits allowed until the deadline; last write wins.
- **Cron triggers** — opt-in open/close, matching, nudge sweeps, packet delivery (T−24h scan), session-start form drops, deadline/overdue sweeps, digests, DM-failure email retries.
- **Bindings:** D1 (db), Email Service (send), secrets: `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `APP_ID`, `FORM_SIGNING_SECRET`.
- Outbound Discord REST for DMs/threads/announcements (paced against rate limits; ≤200 participants is comfortable).
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
7. **M6** — polish: digests, grace window, eligibility flow, admin overrides end-to-end.

Deadline pending **[OPEN — cohort start date]**; M0–M2 before intake opens, M3–M4 before week 1, M5–M6 before week 2 at the latest.

## 12. Open knobs (recap)

1. Weekly schedule anchors (which days) + report deadline style (end-of-week vs 48h-after).
2. Both reports required — confirmed? (Design assumes yes.)
3. Hold-pending-review after strike 2 — default on.
4. Week-3 grace window — default +4 days, repair/reports only.
5. Alumni round v1 = eligibility tracking only.
6. Matching soft preferences (experience band, intern/new-grad) — or pure random.
7. Problem set size (rec 4–6), topics-public compromise, auto-suggest-with-swap vs free choice, location of last year's materials.
8. Interviewer form fields (need access or paste).
9. Domain/subdomain + sender address.
10. Cohort start date → milestone dates.
