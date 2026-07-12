import { COMMANDS } from './discord/commands';
import { closeAndMatch, deadlineSweep, formDropScan, openOptin, optinReminder, scheduleNudge } from './engine/cycle';
import { weeklyDigest } from './engine/digest';
import { executeOutbox } from './engine/executor';
import { drainOutbox } from './engine/outbox';
import { packetScan } from './engine/problems';
import { cleanupOrphanedRecordings } from './engine/recording-cleanup';
import { repairScan } from './engine/repair';
import { activeCohort, cohortStartTuple, cohortWeeks, weekAnchors } from './engine/weeks';
import type { Env } from './env';

// Single */15 cron tick (wrangler.jsonc). The program calendar lives in the
// weeks table, so scheduling survives DST, redeploys, and config changes.
// Every dispatched event claims a unique job_runs key (idempotent), and all
// heavy sends go through the outbox with a bounded per-tick budget.

const STALE_HOURS = 72; // never fire an event more than 3 days late

export async function tick(env: Env, now: Date): Promise<void> {
  const claimed = await claim(env, `tick:${now.toISOString().slice(0, 16)}`, now);
  if (!claimed) return;

  await syncCommands(env).catch((err) => console.error('command sync failed:', err));

  const origin = env.PUBLIC_ORIGIN ?? 'https://wta.hunterchen.ca';
  const cohort = await activeCohort(env).catch(() => null);

  if (cohort) {
    const start = cohortStartTuple(cohort);
    const weeks = await cohortWeeks(env, cohort.id);

    const due = async (key: string, at: Date, fn: () => Promise<unknown>) => {
      if (now.getTime() < at.getTime()) return;
      if (!(await claim(env, key, now))) return;
      if (now.getTime() > at.getTime() + STALE_HOURS * 3600_000) return; // claimed, never fires late
      await fn().catch((err) => console.error(`job ${key} failed:`, err));
    };

    for (const w of weeks) {
      const a = weekAnchors(start, w.idx);
      await due(`optin_open:${w.id}`, new Date(w.optin_opens_at), () => openOptin(env, w));
      await due(`optin_remind:${w.id}`, a.optin_remind_at, () => optinReminder(env, w));
      await due(`match:${w.id}`, new Date(w.match_at), () => closeAndMatch(env, w, cohort));
      await due(`nudge:${w.id}`, a.nudge_at, () => scheduleNudge(env, w));
      await due(`nudge2:${w.id}`, a.nudge2_at, () => scheduleNudge(env, w));
      await due(`digest:${w.id}`, a.digest_at, () => weeklyDigest(env, w));
    }

    await formDropScan(env, origin, now).catch((err) => console.error('formDropScan failed:', err));
    await deadlineSweep(env, origin, now).catch((err) => console.error('deadlineSweep failed:', err));
    await repairScan(env, now).catch((err) => console.error('repairScan failed:', err));
    // Private interviewer packets are a future feature (settings.packet_mode = 'on').
    // Default model: the round's question bank is open (/bank + announcements)
    // and interviewers report which problem they used.
    const { getSetting } = await import('./config');
    if ((await getSetting(env, 'packet_mode')) === 'on') {
      await packetScan(env, origin, now).catch((err) => console.error('packetScan failed:', err));
    }
  }

  await cleanupOrphanedRecordings(env, now).catch((err) => console.error('recording cleanup failed:', err));

  const budget = Math.max(1, Number(env.OUTBOX_BUDGET ?? 20) || 20);
  await drainOutbox(env, executeOutbox, budget, now);
}

export async function claim(env: Env, jobKey: string, now: Date): Promise<boolean> {
  try {
    await env.DB.prepare('INSERT INTO job_runs (job_key, ran_at) VALUES (?1, ?2)')
      .bind(jobKey, now.toISOString())
      .run();
    return true;
  } catch {
    return false; // already ran
  }
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
