import { COMMANDS } from './discord/commands';
import type { Env } from './env';

// Single */15 cron tick (wrangler.jsonc). All real scheduling comes from the
// weeks table so the program calendar is data, not cron expressions — DST-proof
// and adjustable without redeploys. Each dispatched job records itself in
// job_runs first (UNIQUE job_key), making ticks idempotent and safe to overlap.

export async function tick(env: Env, now: Date): Promise<void> {
  const claimed = await claim(env, `tick:${now.toISOString().slice(0, 16)}`, now);
  if (!claimed) return;

  await syncCommands(env).catch((err) => console.error('command sync failed:', err));

  // M2+: read active cohort weeks and dispatch what's due, e.g.:
  //   optin_open / optin_close / run_matching / schedule_nudge (Wed)
  //   packet_delivery (T-24h scan) / form_drop (session start scan)
  //   deadline_sweep / overdue_sweep / weekly_digest / dm_failure_email_retry
  // Each job claims its own key, e.g. `optin_open:week:{id}`.
}

/** Self-syncs slash-command definitions to Discord (global) whenever the
 *  definitions in code differ from what was last pushed. Runs every tick;
 *  costs one DB read when nothing changed. Requires no local tooling. */
export async function syncCommands(env: Env): Promise<'skipped' | 'unchanged' | 'synced'> {
  const { DISCORD_TOKEN, DISCORD_APP_ID } = env;
  if (!DISCORD_TOKEN || !DISCORD_APP_ID) return 'skipped';

  const desired = JSON.stringify(COMMANDS);
  const current = await env.DB.prepare("SELECT value FROM settings WHERE key = 'commands_json'")
    .first<{ value: string }>();
  if (current?.value === desired) return 'unchanged';

  const res = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
    body: desired,
  });
  if (!res.ok) throw new Error(`Discord PUT commands -> ${res.status}: ${await res.text()}`);

  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('commands_json', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1",
  )
    .bind(desired)
    .run();
  return 'synced';
}

async function claim(env: Env, jobKey: string, now: Date): Promise<boolean> {
  try {
    await env.DB.prepare('INSERT INTO job_runs (job_key, ran_at) VALUES (?1, ?2)')
      .bind(jobKey, now.toISOString())
      .run();
    return true;
  } catch {
    return false; // already ran
  }
}
