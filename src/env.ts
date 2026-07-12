export type Env = {
  DB: D1Database;
  // Secrets — optional so the Worker boots before configuration; handlers guard.
  DISCORD_APP_ID?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_TOKEN?: string;
  FORM_SIGNING_SECRET?: string;
  // M5: EMAIL: SendEmail (Email Service binding)
};
