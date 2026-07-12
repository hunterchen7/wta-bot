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
  // M5: EMAIL: SendEmail (Email Service binding)
};
