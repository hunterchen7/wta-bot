import { getSettings } from '../config';
import type { Env } from '../env';
import { creditsOf } from './progress';
import { deadLetters, enqueue } from './outbox';
import type { Week } from './weeks';

/** Monday-morning organizer digest for the week just ended (DESIGN §2, §7). */
export async function weeklyDigest(env: Env, week: Week): Promise<void> {
  const cfg = await getSettings(env, ['organizer_channel_id']);
  if (!cfg.organizer_channel_id) return;

  const stats = await env.DB.prepare(
    `SELECT
       count(*) AS total,
       sum(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) AS completed,
       sum(CASE WHEN state = 'scheduled' THEN 1 ELSE 0 END) AS scheduled,
       sum(CASE WHEN state = 'pending_schedule' THEN 1 ELSE 0 END) AS unscheduled,
       sum(CASE WHEN state = 'broken' THEN 1 ELSE 0 END) AS broken
     FROM sessions WHERE week_id = ?1`,
  )
    .bind(week.id)
    .first<any>();

  const overdueForms = await env.DB.prepare(
    `SELECT count(*) AS n FROM form_instances f
     JOIN sessions s ON s.id = f.session_id
     WHERE s.week_id = ?1 AND f.submitted_at IS NULL`,
  )
    .bind(week.id)
    .first<{ n: number }>();

  const { results: incidents } = await env.DB.prepare(
    `SELECT i.kind, p.discord_id FROM incidents i
     LEFT JOIN participants p ON p.id = i.accused_id
     JOIN sessions s ON s.id = i.session_id
     WHERE s.week_id = ?1 AND i.state = 'confirmed'`,
  )
    .bind(week.id)
    .all<{ kind: string; discord_id: string | null }>();

  // Behind pace: active enrolled participants short of idx credits per role
  const { results: active } = await env.DB.prepare(
    "SELECT id, discord_id FROM participants WHERE status = 'active' AND topics IS NOT NULL",
  ).all<{ id: number; discord_id: string }>();
  const behind: string[] = [];
  for (const p of active) {
    const c = await creditsOf(env, p.id);
    if (c.interviewer < week.idx || c.interviewee < week.idx) {
      behind.push(`<@${p.discord_id}> (${c.interviewer}/${week.idx} ・ ${c.interviewee}/${week.idx})`);
    }
  }

  const { results: repairs } = await env.DB.prepare(
    "SELECT count(*) AS n FROM repair_queue WHERE week_id = ?1 AND state = 'open'",
  )
    .bind(week.id)
    .all<{ n: number }>();

  const dead = await deadLetters(env);

  const lines = [
    `📊 **Round ${week.idx} digest**`,
    `Sessions: ${stats?.completed ?? 0}/${stats?.total ?? 0} completed · ${stats?.scheduled ?? 0} scheduled · ${stats?.unscheduled ?? 0} never scheduled · ${stats?.broken ?? 0} broken`,
    `Reports outstanding: ${overdueForms?.n ?? 0}`,
    incidents.length
      ? `No-shows/incidents confirmed: ${incidents.map((i) => `${i.kind}${i.discord_id ? ` <@${i.discord_id}>` : ''}`).join(', ')}`
      : 'No confirmed incidents 🎉',
    repairs[0]?.n ? `Repair queue still open: ${repairs[0].n}` : null,
    behind.length ? `**Behind pace (${behind.length}):** ${behind.slice(0, 15).join(', ')}${behind.length > 15 ? '…' : ''}` : 'Everyone on pace 🎉',
    dead.length ? `⚠️ ${dead.length} undeliverable outbox item(s) — check OPERATIONS.md` : null,
  ].filter(Boolean);

  await enqueue(env, 'channel_msg', {
    channelId: cfg.organizer_channel_id,
    message: { content: lines.join('\n') },
  });
}
