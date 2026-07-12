import { getSettings } from '../config';
import type { Env } from '../env';
import { getSession, reportIncident } from './incidents';
import { enqueue } from './outbox';
import { creditsOf } from './progress';

// Report-submission side effects (DESIGN §5): credit, attendance cross-check,
// feedback relay, W3 verdict → review queue, eligibility.

type Instance = {
  id: number;
  kind: string;
  session_id: number;
  assignee_id: number;
  payload: string | null;
  submitted_at: string | null;
};

export async function onReportSubmitted(
  env: Env,
  instance: Instance,
  payload: Record<string, string>,
  origin?: string,
): Promise<void> {
  const session = await getSession(env, instance.session_id);
  if (!session) return;
  const side = instance.kind === 'interviewer_report' ? 'interviewer' : 'interviewee';

  // Interviewee filed -> record exposure + release the solution (DESIGN §6).
  if (side === 'interviewee') {
    const { releaseSolution } = await import('./problems');
    await releaseSolution(env, session.id, origin ?? env.PUBLIC_ORIGIN ?? 'https://wta.hunterchen.ca');
  }

  // 1) Credit the submitter's side; complete the session when both sides in.
  await env.DB.prepare(
    `UPDATE sessions SET ${side === 'interviewer' ? 'interviewer_credited' : 'interviewee_credited'} = 1 WHERE id = ?1`,
  )
    .bind(session.id)
    .run();
  const fresh = await getSession(env, session.id);
  if (fresh && (fresh as any).interviewer_credited === 1 && (fresh as any).interviewee_credited === 1 && fresh.state !== 'broken') {
    await env.DB.prepare("UPDATE sessions SET state = 'completed' WHERE id = ?1").bind(session.id).run();
  }

  // 2) Attendance cross-check: "partner didn't show" on a form == a no-show
  //    report, unless the session is already marked broken.
  if (payload.attendance_partner === 'no' && fresh?.state !== 'broken') {
    const reporter = await env.DB.prepare('SELECT discord_id FROM participants WHERE id = ?1')
      .bind(instance.assignee_id)
      .first<{ discord_id: string }>();
    if (reporter) await reportIncident(env, fresh!, 'ghost', reporter.discord_id);
  }

  // 3) Mismatch flag: both in, disagreeing attendance answers.
  const other = await env.DB.prepare(
    `SELECT * FROM form_instances WHERE session_id = ?1 AND id != ?2`,
  )
    .bind(session.id, instance.id)
    .first<Instance>();
  if (other?.submitted_at && other.payload) {
    const otherPayload = JSON.parse(other.payload) as Record<string, string>;
    const disagree =
      (payload.attendance_partner === 'no') !== (otherPayload.attendance_self === 'no') ||
      (otherPayload.attendance_partner === 'no') !== (payload.attendance_self === 'no');
    if (disagree) {
      const { organizer_channel_id } = await getSettings(env, ['organizer_channel_id']);
      if (organizer_channel_id) {
        await enqueue(env, 'channel_msg', {
          channelId: organizer_channel_id,
          message: { content: `⚖️ Attendance answers disagree on session #${session.id} — worth a look (\`/standing\` both sides).` },
        });
      }
    }
    // 4) Both in -> relay shared fields both ways.
    await relayShared(env, session.id, instance, payload, other, otherPayload);
  }

  // 5) W3 verdict: pass -> recording review queue; fail/borderline recorded.
  if (instance.kind === 'interviewer_report') {
    const week = await env.DB.prepare(
      `SELECT w.idx, w.cohort_id, c.weeks_count FROM weeks w JOIN cohorts c ON c.id = w.cohort_id WHERE w.id = ?1`,
    )
      .bind(session.week_id)
      .first<{ idx: number; cohort_id: number; weeks_count: number }>();
    if (week && week.idx === week.weeks_count && payload.verdict === 'pass') {
      await env.DB.prepare("UPDATE sessions SET review_state = 'pending' WHERE id = ?1").bind(session.id).run();
      const { organizer_channel_id } = await getSettings(env, ['organizer_channel_id']);
      if (organizer_channel_id) {
        await enqueue(env, 'channel_msg', {
          channelId: organizer_channel_id,
          message: { content: `🎬 R${week.idx} **pass verdict** on session #${session.id} — recording queued for review (dashboard → Reviews).` },
        });
      }
    }
  }

  await maybeMarkEligible(env, session.interviewer_id);
  await maybeMarkEligible(env, session.interviewee_id);
}

async function relayShared(
  env: Env,
  sessionId: number,
  a: Instance,
  aPayload: Record<string, string>,
  b: Instance,
  bPayload: Record<string, string>,
): Promise<void> {
  const { fieldsFor } = await import('../forms/schema');
  const pair: Array<[Instance, Record<string, string>, Instance]> = [
    [a, aPayload, b],
    [b, bPayload, a],
  ];
  for (const [from, fromPayload, to] of pair) {
    const shared = (fieldsFor(from.kind) ?? []).filter((f) => f.shared && fromPayload[f.id]);
    if (shared.length === 0) continue;
    const recipient = await env.DB.prepare('SELECT discord_id FROM participants WHERE id = ?1')
      .bind(to.assignee_id)
      .first<{ discord_id: string }>();
    if (!recipient) continue;
    const lines = shared.map((f) => `**${f.label}:**\n> ${fromPayload[f.id]!.slice(0, 800)}`);
    await enqueue(env, 'dm', {
      userId: recipient.discord_id,
      fallbackKind: 'feedback_relay',
      message: { content: `💬 **Feedback from your session partner:**\n${lines.join('\n')}` },
    });
  }
}

/** Eligibility (DESIGN §1): 3+3 credits AND final-week interviewee session
 *  with a pass verdict AND its recording verified. Marks status=completed
 *  and celebrates. */
export async function maybeMarkEligible(env: Env, participantId: number): Promise<boolean> {
  const p = await env.DB.prepare('SELECT id, discord_id, name, status FROM participants WHERE id = ?1')
    .bind(participantId)
    .first<{ id: number; discord_id: string; name: string | null; status: string }>();
  if (!p || p.status !== 'active') return false;

  const credits = await creditsOf(env, participantId);
  if (credits.interviewer < 3 || credits.interviewee < 3) return false;

  const w3pass = await env.DB.prepare(
    `SELECT s.id FROM sessions s
     JOIN weeks w ON w.id = s.week_id
     JOIN cohorts c ON c.id = w.cohort_id AND c.status = 'active' AND w.idx = c.weeks_count
     JOIN form_instances f ON f.session_id = s.id AND f.kind = 'interviewer_report' AND f.submitted_at IS NOT NULL
     WHERE s.interviewee_id = ?1 AND s.review_state = 'verified'
       AND json_extract(f.payload, '$.verdict') = 'pass'
     LIMIT 1`,
  )
    .bind(participantId)
    .first();
  if (!w3pass) return false;

  await env.DB.prepare("UPDATE participants SET status = 'completed' WHERE id = ?1").bind(participantId).run();
  await enqueue(env, 'dm', {
    userId: p.discord_id,
    fallbackKind: 'eligible',
    message: {
      content:
        '🏆 **You did it — 6/6 interviews and a verified final-round pass.** You\'re now eligible for the alumni technical interview; organizers will reach out with next steps. Huge congrats!',
    },
  });
  const { organizer_channel_id } = await getSettings(env, ['organizer_channel_id']);
  if (organizer_channel_id) {
    await enqueue(env, 'channel_msg', {
      channelId: organizer_channel_id,
      message: { content: `🏆 **${p.name ?? p.discord_id}** (<@${p.discord_id}>) is **alumni-round eligible** — 6/6 + verified final-round pass.` },
    });
  }
  return true;
}
