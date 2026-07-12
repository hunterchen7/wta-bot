# Web app migration

The dashboard is moving incrementally from server-rendered HTML to a React,
Vite, and Tailwind application under `/app/`. The Cloudflare Worker remains
the backend and continues to own authentication, authorization, D1 access,
Discord, email, cron jobs, report forms, and business rules.

## Architecture

- `web/` — React client, built by Vite and deployed as Worker static assets.
- `/api/*` — authenticated Hono JSON endpoints consumed by the client.
- `/dashboard/*` — legacy server-rendered dashboard during the parity phase.
- `/login`, `/auth/*`, `/f/*`, `/p/*` — existing server-rendered flows remain
  in place until there is a concrete reason to migrate them.

The SPA receives one aggregated dashboard payload instead of issuing a chain
of dependent requests. Mutations remain authorized and validated in the
Worker; the browser never owns program rules.

## Parity sequence

1. My Progress and participant Settings.
2. Organizer roster and participant profiles.
3. Round board and operational queues.
4. Recording reviews and problem management.
5. Redirect `/dashboard` to `/app/` and remove the equivalent legacy views.

Each legacy view stays available until its replacement is tested and usable.

## Admin features after parity

- Operational overview: enrollment, opt-in, matching, scheduling, reports,
  incidents, repairs, and eligibility.
- Filterable roster with bulk hold/release/message/export operations.
- Round timeline and exception queues for unscheduled or overdue sessions.
- Attendance, completion, ratings, verdict, and problem-difficulty trends.
- Audit history for every consequential organizer action.
- Saved filters and exports for cohort handoff and post-program analysis.

High-impact mutations should be added only after an audit-log migration and
confirmation patterns are in place.
