import { getSettings } from '../config';
import type { Env } from '../env';
import { discordTime } from '../time';
import { sessionButtons } from './cycle';
import { pickProblem, reserveProblem } from './problems';
import { enqueue } from './outbox';
import { getWeek } from './weeks';

// Mid-week repair queue (DESIGN §3–4): broken sessions enqueue typed needs;
// complementary victims fix each other, standby volunteers fill the rest.

type QueueRow = { id: number; week_id: number; participant_id: number; need: 'interviewer' | 'interviewee' };

export async function enqueueRepair(
  env: Env,
  weekId: number,
  participantId: number,
  need: 'interviewer' | 'interviewee',
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO repair_queue (week_id, participant_id, need, state) VALUES (?1, ?2, ?3, 'open')`,
  )
    .bind(weekId, participantId, need)
    .run();
}

/** Runs each tick during active weeks: match complementary open needs, then
 *  try standby volunteers. Anything left converts to next-week deficits by
 *  simply… remaining uncredited (demand math picks it up automatically). */
export async function repairScan(env: Env, now = new Date()): Promise<number> {
  const { results: open } = await env.DB.prepare(
    `SELECT r.id, r.week_id, r.participant_id, r.need FROM repair_queue r
     JOIN weeks w ON w.id = r.week_id
     JOIN participants p ON p.id = r.participant_id
     WHERE r.state = 'open' AND ?1 <= COALESCE(w.grace_until, w.reports_due_at)
       AND p.status = 'active' AND p.pairing_excluded = 0
     ORDER BY r.id`,
  )
    .bind(now.toISOString())
    .all<QueueRow>();
  if (open.length === 0) return 0;

  let created = 0;

  // 1) Complementary victims within the same week
  const used = new Set<number>();
  for (const a of open) {
    if (used.has(a.id)) continue;
    const b = open.find(
      (x) =>
        !used.has(x.id) &&
        x.id !== a.id &&
        x.week_id === a.week_id &&
        x.need !== a.need &&
        x.participant_id !== a.participant_id,
    );
    if (!b) continue;
    // a needs X, b needs the opposite — orient the session accordingly.
    const interviewerId = a.need === 'interviewer' ? b.participant_id : a.participant_id;
    const intervieweeId = a.need === 'interviewer' ? a.participant_id : b.participant_id;
    if (await pairedBefore(env, a.week_id, interviewerId, intervieweeId)) continue;
    used.add(a.id);
    used.add(b.id);
    await createRepairSession(env, a.week_id, interviewerId, intervieweeId, [a.id, b.id]);
    created++;
  }

  // 2) Standby volunteers for whoever is left
  for (const a of open) {
    if (used.has(a.id)) continue;
    const volunteer = await env.DB.prepare(
      `SELECT o.participant_id FROM optins o
       JOIN participants p ON p.id = o.participant_id AND p.status = 'active' AND p.pairing_excluded = 0
       WHERE o.week_id = ?1 AND o.standby = 1 AND o.participant_id != ?2
       ORDER BY RANDOM() LIMIT 5`,
    )
      .bind(a.week_id, a.participant_id)
      .all<{ participant_id: number }>()
      .then((r) => {
        return (async () => {
          for (const cand of r.results) {
            const interviewerId = a.need === 'interviewer' ? cand.participant_id : a.participant_id;
            const intervieweeId = a.need === 'interviewer' ? a.participant_id : cand.participant_id;
            if (!(await pairedBefore(env, a.week_id, interviewerId, intervieweeId))) {
              return cand.participant_id;
            }
          }
          return null;
        })();
      });
    if (!volunteer) continue;
    const interviewerId = a.need === 'interviewer' ? volunteer : a.participant_id;
    const intervieweeId = a.need === 'interviewer' ? a.participant_id : volunteer;
    used.add(a.id);
    await createRepairSession(env, a.week_id, interviewerId, intervieweeId, [a.id]);
    created++;
  }
  return created;
}

export async function pairedBefore(env: Env, weekId: number, a: number, b: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM sessions s
     JOIN weeks w ON w.id = s.week_id
     WHERE w.cohort_id = (SELECT cohort_id FROM weeks WHERE id = ?1)
       AND s.state != 'cancelled'
       AND ((s.interviewer_id = ?2 AND s.interviewee_id = ?3) OR (s.interviewer_id = ?3 AND s.interviewee_id = ?2))
     LIMIT 1`,
  )
    .bind(weekId, a, b)
    .first();
  return row !== null;
}

async function createRepairSession(
  env: Env,
  weekId: number,
  interviewerId: number,
  intervieweeId: number,
  queueIds: number[],
): Promise<void> {
  await spawnSession(env, weekId, interviewerId, intervieweeId, 'repair');
  for (const qid of queueIds) {
    await env.DB.prepare("UPDATE repair_queue SET state = 'matched' WHERE id = ?1").bind(qid).run();
  }
}

/** Create a session with its thread + partner DMs — repairs and /pair share it. */
export async function spawnSession(
  env: Env,
  weekId: number,
  interviewerId: number,
  intervieweeId: number,
  origin: 'repair' | 'manual',
): Promise<number> {
  const eligible = await env.DB.prepare(
    `SELECT count(*) AS n FROM participants
     WHERE id IN (?1, ?2) AND status = 'active' AND pairing_excluded = 0`,
  ).bind(interviewerId, intervieweeId).first<{ n: number }>();
  if (Number(eligible?.n ?? 0) !== 2) {
    throw new Error('Both participants must be active and eligible for matching.');
  }
  const ins = await env.DB.prepare(
    `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, state, origin)
     VALUES (?1, ?2, ?3, 'pending_schedule', ?4)`,
  )
    .bind(weekId, interviewerId, intervieweeId, origin)
    .run();
  const sessionId = Number(ins.meta.last_row_id);
  const problem = await pickProblem(env, weekId, interviewerId, intervieweeId);
  if (problem) await reserveProblem(env, sessionId, problem.id);

  const week = await getWeek(env, weekId);
  const people = await env.DB.prepare(
    'SELECT id, discord_id, name FROM participants WHERE id IN (?1, ?2)',
  )
    .bind(interviewerId, intervieweeId)
    .all<{ id: number; discord_id: string; name: string | null }>();
  const interviewer = people.results.find((p) => p.id === interviewerId)!;
  const interviewee = people.results.find((p) => p.id === intervieweeId)!;
  const deadline = week?.grace_until ?? week?.reports_due_at ?? new Date().toISOString();

  const label = origin === 'repair' ? 'Repair pairing' : 'Catch-up pairing (organizer-arranged)';
  const cfg = await getSettings(env, ['threads_channel_id']);
  if (cfg.threads_channel_id) {
    await enqueue(env, 'thread_create', {
      sessionId,
      channelId: cfg.threads_channel_id,
      name: `r${week?.idx ?? '?'} ${origin} · ${interviewer.name ?? 'interviewer'} → ${interviewee.name ?? 'interviewee'}`,
      starter: {
        content:
          `🛠️ **${label}** — <@${interviewer.discord_id}> interviews <@${interviewee.discord_id}>.\n` +
          `Agree on a time and hit **Scheduled ✅** — everything due ${discordTime(deadline)}.`,
        components: [sessionButtons(sessionId)],
      },
    });
  }
  for (const p of [interviewer, interviewee]) {
    await enqueue(env, 'dm', {
      userId: p.discord_id,
      fallbackKind: 'repair_pairing',
      message: { content: `🛠️ ${label}: ${interviewer.name ?? 'someone'} interviews ${interviewee.name ?? 'someone'}. Check the session thread to schedule — due ${discordTime(deadline)}.` },
    });
  }
  return sessionId;
}
