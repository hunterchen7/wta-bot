import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { releaseSolution } from '../src/engine/problems';

describe('interviewee solution release', () => {
  it('releases only when the interviewee says both people attended an unbroken session', async () => {
    await env.DB.prepare(
      `INSERT INTO cohorts (id, name, status) VALUES (8201, 'Solution release', 'active')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO weeks (id, cohort_id, idx, reports_due_at)
       VALUES (8201, 8201, 1, '2026-10-01T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO participants (id, discord_id, name, status)
       VALUES
         (8201, 'solution-interviewer', 'Interviewer', 'active'),
         (8202, 'solution-interviewee', 'Interviewee', 'active')`,
    ).run();
    const problem = await env.DB.prepare(
      `INSERT INTO problems (title, difficulty, statement_md, solution_md)
       VALUES ('Private problem', 'easy', 'Statement', 'Solution')`,
    ).run();
    const problemId = Number(problem.meta.last_row_id);

    const createSession = async (id: number, state: 'scheduled' | 'broken', attendance: Record<string, string>) => {
      await env.DB.prepare(
        `INSERT INTO sessions (id, week_id, interviewer_id, interviewee_id, problem_id, state)
         VALUES (?1, 8201, 8201, 8202, ?2, ?3)`,
      ).bind(id, problemId, state).run();
      await env.DB.prepare(
        `INSERT INTO form_instances
           (kind, session_id, assignee_id, token_hash, deadline_at, submitted_at, payload)
         VALUES
           ('interviewee_report', ?1, 8202, ?2, '2026-10-01T00:00:00.000Z',
            '2026-09-01T00:00:00.000Z', ?3)`,
      ).bind(id, crypto.randomUUID(), JSON.stringify(attendance)).run();
    };

    await createSession(8201, 'scheduled', { attendance_self: 'yes', attendance_partner: 'no' });
    await releaseSolution(env, 8201, 'https://example.test');
    expect(await exposureCount(8201)).toBe(0);
    expect(await solutionDmCount()).toBe(0);

    await env.DB.prepare(
      `UPDATE form_instances SET payload = ?2 WHERE session_id = ?1`,
    ).bind(8201, JSON.stringify({ attendance_self: 'late', attendance_partner: 'yes' })).run();
    await releaseSolution(env, 8201, 'https://example.test');
    expect(await exposureCount(8201)).toBe(1);
    expect(await solutionDmCount()).toBe(1);

    await createSession(8202, 'broken', { attendance_self: 'yes', attendance_partner: 'yes' });
    await releaseSolution(env, 8202, 'https://example.test');
    expect(await exposureCount(8202)).toBe(0);

    await createSession(8203, 'scheduled', { attendance_self: 'no', attendance_partner: 'yes' });
    await releaseSolution(env, 8203, 'https://example.test');
    expect(await exposureCount(8203)).toBe(0);
    expect(await solutionDmCount()).toBe(1);
  });
});

async function exposureCount(sessionId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT count(*) AS n FROM exposures
     WHERE session_id = ?1 AND role = 'interviewee'`,
  ).bind(sessionId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function solutionDmCount(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT count(*) AS n FROM outbox
     WHERE kind = 'dm' AND json_extract(payload, '$.fallbackKind') = 'solution'`,
  ).first<{ n: number }>();
  return Number(row?.n ?? 0);
}
