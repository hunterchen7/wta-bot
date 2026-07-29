import type { Env } from '../env';
import { enqueue } from './outbox';

type SessionThread = {
  thread_id: string | null;
  interviewer_id: number;
  interviewee_id: number;
};

export async function closeSessionThread(
  env: Env,
  session: SessionThread,
  message?: string,
  status: 'cancelled' | 'closed' = 'cancelled',
): Promise<void> {
  if (!session.thread_id) return;
  const { results } = await env.DB.prepare(
    'SELECT id, name FROM participants WHERE id IN (?1, ?2)',
  ).bind(session.interviewer_id, session.interviewee_id).all<{ id: number; name: string | null }>();
  const interviewer = results.find((participant) => participant.id === session.interviewer_id);
  const interviewee = results.find((participant) => participant.id === session.interviewee_id);
  const name = `${status} · ${interviewer?.name ?? 'interviewer'} → ${interviewee?.name ?? 'interviewee'}`;

  await enqueue(env, 'thread_close', {
    channelId: session.thread_id,
    name,
    ...(message ? { message: { content: message } } : {}),
  });
}

export async function closeStaleSessionThreads(env: Env, limit = 25): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT s.thread_id, s.interviewer_id, s.interviewee_id, s.state,
            (SELECT kind FROM incidents WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS incident_kind
     FROM sessions s
     WHERE s.thread_id IS NOT NULL AND s.state IN ('broken', 'cancelled')
       AND NOT EXISTS (
         SELECT 1 FROM outbox o
         WHERE o.kind = 'thread_close'
           AND json_extract(o.payload, '$.channelId') = s.thread_id
       )
     ORDER BY s.id
     LIMIT ?1`,
  ).bind(limit).all<SessionThread & { state: string; incident_kind: string | null }>();

  for (const session of results) {
    const status = session.state === 'cancelled' || session.incident_kind === 'late_cancel'
      ? 'cancelled'
      : 'closed';
    await closeSessionThread(env, session, undefined, status);
  }
  return results.length;
}
