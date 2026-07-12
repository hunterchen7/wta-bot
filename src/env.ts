export type Env = {
  DB: D1Database;
  // Secrets — optional so the Worker boots before configuration; handlers guard.
  DISCORD_APP_ID?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_TOKEN?: string;
  FORM_SIGNING_SECRET?: string;
  // The app is public on Discord's side; this allowlist is the real gate.
  // Comma-separated guild ids. Unset/empty = allow all (pre-setup only).
  // Foreign-guild interactions get an ephemeral refusal + the bot leaves.
  ALLOWED_GUILD_IDS?: string;
  // Public base URL for links minted outside a request context (cron DMs).
  PUBLIC_ORIGIN?: string;
  // Comma-separated emails that get organizer views on the web dashboard
  // (checked at login, alongside the Discord organizer-role fallback).
  DASHBOARD_ADMINS?: string;
  // Outbox rows drained per tick (Discord/email sends). Default 20 — safe on
  // the free plan's external-subrequest cap; raise on Workers Paid.
  OUTBOX_BUDGET?: string;
  // Email Service binding (M5+; optional until the domain is enabled).
  EMAIL?: { send(message: unknown): Promise<void> };
};
