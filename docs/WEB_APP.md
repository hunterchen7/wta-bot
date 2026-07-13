# Web application

Every human-facing WTA surface is a React, Vite, and Tailwind page. The
Cloudflare Worker is a JSON/API backend and still owns authentication,
authorization, signed-link verification, D1 writes, Discord, email, cron jobs,
validation, and report side effects.

## Routes

- `/login` — email-code authentication.
- `/app/*` — authenticated participant and organizer dashboard.
- `/enroll/:token` — Discord-linked enrollment/profile form minted by `/join`.
- `/f/:token` — signed interview report form.
- `/p/:token` — signed interviewer packet or released solution.
- `/bank` — current round question bank when an organizer explicitly publishes it; private by default.
- `/preview/*` — interactive, non-writing versions of public flows.
- `/api/*` — Worker JSON endpoints consumed by the React application.

Legacy `/dashboard/*` bookmarks are redirects only. There are no
server-rendered templates or HTML form POST handlers.

## Boundaries

The browser renders fields and provides immediate UX feedback, but never owns
program rules. The Worker re-verifies every token, validates every submitted
field, applies permissions, writes D1, and triggers durable side effects.

Discord usernames are refreshed from signed interactions and stored beside the
immutable Discord user ID. Both are exposed in participant/admin views so a
dashboard profile can always be reconciled with the Discord account.
