import type { Env } from './env';

// Single */15 cron tick (wrangler.jsonc). All real scheduling comes from the
// weeks table so the program calendar is data, not cron expressions — DST-proof
// and adjustable without redeploys. Each dispatched job records itself in
// job_runs first (UNIQUE job_key), making ticks idempotent and safe to overlap.

export async function tick(env: Env, now: Date): Promise<void> {
  const claimed = await claim(env, `tick:${now.toISOString().slice(0, 16)}`, now);
  if (!claimed) return;

  // M2+: read active cohort weeks and dispatch what's due, e.g.:
  //   optin_open / optin_close / run_matching / schedule_nudge (Wed)
  //   packet_delivery (T-24h scan) / form_drop (session start scan)
  //   deadline_sweep / overdue_sweep / weekly_digest / dm_failure_email_retry
  // Each job claims its own key, e.g. `optin_open:week:{id}`.
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
