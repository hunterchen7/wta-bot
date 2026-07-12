import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateWeekSet, packetScan, pickProblem, swapProblem } from '../src/engine/problems';
import { createCohort } from '../src/engine/weeks';
import { app } from '../src/index';

let weekIds: number[] = [];
let sessionId: number;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO participants (discord_id, name, preferred_email, topics, status) VALUES
     ('301', 'Pat', 'pat@example.com', '["dsa"]', 'active'),
     ('302', 'Quinn', 'quinn@example.com', '["dsa"]', 'active')`,
  ).run();
  const { weeks } = await createCohort(env, 'Problems Test', [2026, 9, 14]);
  weekIds = weeks.map((w) => w.id);

  // Bank: 3 easy, 3 medium, 2 harder-medium, 2 hard-in-band, 1 hard-out-of-band
  const rows: Array<[number | null, string, string, number | null]> = [
    [1, 'Two Sum', 'easy', null],
    [20, 'Valid Parentheses', 'easy', 1.2],
    [121, 'Best Time to Buy', 'easy', 1.5],
    [3, 'Longest Substring', 'medium', 2.0],
    [56, 'Merge Intervals', 'medium', 2.2],
    [200, 'Number of Islands', 'medium', 2.3],
    [146, 'LRU Cache', 'medium', 2.7],
    [287, 'Find Duplicate', 'medium', 2.9],
    [42, 'Trapping Rain Water', 'hard', 3.0],
    [295, 'Median from Stream', 'hard', 3.1],
    [10, 'Regex Matching', 'hard', null], // effective 3.0 -> in band
  ];
  for (const [number, title, difficulty, rank] of rows) {
    await env.DB.prepare(
      'INSERT INTO problems (number, title, url, difficulty, difficulty_rank, available_weeks) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    )
      .bind(number, title, `https://leetcode.com/problems/${number}`, difficulty, rank,
        difficulty === 'easy' ? '[1]' : difficulty === 'medium' && (rank ?? 2) < 2.5 ? '[2]' : '[3]')
      .run();
  }
});

describe('problem bank', () => {
  it('generates week sets inside the difficulty bands', async () => {
    const w1 = await generateWeekSet(env, weekIds[0]!, 1, 5);
    expect(w1.chosen.length).toBe(3); // only 3 questions are tagged for round 1
    const w2 = await generateWeekSet(env, weekIds[1]!, 2, 3);
    expect(w2.chosen.length).toBe(3);
    const w3 = await generateWeekSet(env, weekIds[2]!, 3, 5);
    expect(w3.chosen.length).toBe(5); // 146, 287, 42, 295, 10

    const { results } = await env.DB.prepare(
      `SELECT p.title, p.difficulty FROM week_problem_sets wps JOIN problems p ON p.id = wps.problem_id WHERE wps.week_id = ?1`,
    )
      .bind(weekIds[2])
      .all<any>();
    expect(results.map((r: any) => r.title).sort()).toEqual(
      ['Find Duplicate', 'LRU Cache', 'Median from Stream', 'Regex Matching', 'Trapping Rain Water'].sort(),
    );
  });

  it('packet scan assigns a problem, records interviewer exposure, DMs the packet', async () => {
    const ins = await env.DB.prepare(
      `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, state, scheduled_at)
       VALUES (?1, 1, 2, 'scheduled', ?2)`,
    )
      .bind(weekIds[2], new Date(Date.now() + 3600_000).toISOString())
      .run();
    sessionId = Number(ins.meta.last_row_id);

    const assigned = await packetScan(env, 'https://example.test');
    expect(assigned).toBe(1);

    const s = await env.DB.prepare('SELECT problem_id FROM sessions WHERE id = ?1').bind(sessionId).first<any>();
    expect(s.problem_id).not.toBeNull();
    const exp = await env.DB.prepare(
      "SELECT count(*) AS n FROM exposures WHERE participant_id = 1 AND role = 'interviewer'",
    ).first<any>();
    expect(exp.n).toBe(1);
    const dm = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'dm' AND payload LIKE '%packet%' ORDER BY id DESC LIMIT 1",
    ).first<any>();
    expect(dm).not.toBeNull();
    const payload = JSON.parse(dm.payload);
    expect(payload.userId).toBe('301');
    expect(payload.message.content).toContain('/p/');
  });

  it('serves packet data to the signed React link and refuses garbage', async () => {
    const dm = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'dm' AND payload LIKE '%/p/%' ORDER BY id DESC LIMIT 1",
    ).first<any>();
    const url = new URL(JSON.parse(dm.payload).message.content.match(/https?:\/\/\S+\/p\/\S+/)![0]);
    const res = await app.request(`/api/problems/${url.pathname.split('/').at(-1)}`, {}, env);
    expect(res.status).toBe(200);
    expect(await res.json<any>()).toMatchObject({ mode: 'packet', problem: { title: expect.any(String) } });

    expect((await app.request('/api/problems/garbage', {}, env)).status).toBe(404);
  });

  it('swap re-picks (interviewer only), avoiding the current problem', async () => {
    const before = await env.DB.prepare('SELECT problem_id FROM sessions WHERE id = ?1').bind(sessionId).first<any>();
    const denied = await swapProblem(env, sessionId, '302', 'https://example.test');
    expect(denied).toContain('Only the interviewer');
    const ok = await swapProblem(env, sessionId, '301', 'https://example.test');
    expect(ok).toContain('Swapped');
    const after = await env.DB.prepare('SELECT problem_id FROM sessions WHERE id = ?1').bind(sessionId).first<any>();
    expect(after.problem_id).not.toBe(before.problem_id);
  });

  it('serves the public question-bank API with the current round set', async () => {
    const res = await app.request('/api/public/bank', {}, env);
    expect(res.status).toBe(200);
    const bank = await res.json<any>();
    expect(bank.problems.map((problem: any) => problem.title)).toContain('Two Sum');
  });

  it('open-bank mode: interviewer report offers the round set and records the pick', async () => {
    const { signFormToken } = await import('../src/forms/token');
    // fresh session in week 3, no packet assignment
    const ins = await env.DB.prepare(
      `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, state, scheduled_at)
       VALUES (?1, 2, 1, 'scheduled', ?2)`,
    )
      .bind(weekIds[2], new Date().toISOString())
      .run();
    const sid = Number(ins.meta.last_row_id);
    const fi = await env.DB.prepare(
      `INSERT INTO form_instances (kind, session_id, assignee_id, token_hash, deadline_at)
       VALUES ('interviewer_report', ?1, 2, ?2, ?3)`,
    )
      .bind(sid, crypto.randomUUID(), new Date(Date.now() + 86400_000).toISOString())
      .run();
    const token = await signFormToken(env.FORM_SIGNING_SECRET!, Number(fi.meta.last_row_id), new Date(Date.now() + 86400_000));

    const res = await app.request(`/api/forms/${token}`, {}, env);
    const form = await res.json<any>();
    const problemField = form.fields.find((field: any) => field.id === 'problem_used');
    expect(problemField.label).toContain('Which interview question');
    expect(problemField.options.map((option: any) => option.label)).toEqual(expect.arrayContaining([expect.stringContaining('LRU Cache')]));

    const set = await env.DB.prepare('SELECT problem_id FROM week_problem_sets WHERE week_id = ?1 LIMIT 1')
      .bind(weekIds[2])
      .first<any>();
    const submit = await app.request(
      `/api/forms/${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendance_self: 'yes',
          attendance_partner: 'yes',
          camera_self: 'yes',
          camera_partner: 'yes',
          rating_experience: '5',
          rating_preparedness: '4',
          rating_clarifying_questions: '4',
          described_naive_solution: 'yes',
          implemented_naive_solution: 'yes',
          described_optimal_solution: 'yes',
          implemented_optimal_solution: 'yes',
          additional_solutions: 'not_applicable',
          time_complexity: 'yes',
          space_complexity: 'yes',
          additional_test_cases: 'yes',
          problem_used: String(set.problem_id),
          rating_problem_solving: '4',
          rating_communication: '4',
          rating_code_quality: '4',
          hints: 'few',
          duration: '20-30 minutes',
          code: 'function solve() { return 42; }',
          confirmation: 'yes',
        }),
      },
      env,
    );
    expect(submit.status).toBe(200);
    const s = await env.DB.prepare('SELECT problem_id FROM sessions WHERE id = ?1').bind(sid).first<any>();
    expect(s.problem_id).toBe(set.problem_id);
    const exp = await env.DB.prepare(
      "SELECT count(*) AS n FROM exposures WHERE session_id = ?1 AND role = 'interviewer'",
    )
      .bind(sid)
      .first<any>();
    expect(exp.n).toBe(1);
  });

  it('never hands the interviewee a problem they have seen', async () => {
    // Expose Quinn (participant 2) to every W3 problem except one.
    const { results: set } = await env.DB.prepare(
      'SELECT problem_id FROM week_problem_sets WHERE week_id = ?1',
    )
      .bind(weekIds[2])
      .all<any>();
    for (const row of set.slice(0, set.length - 1)) {
      await env.DB.prepare(
        "INSERT INTO exposures (participant_id, problem_id, role) VALUES (2, ?1, 'interviewee')",
      )
        .bind(row.problem_id)
        .run();
    }
    const remaining = set[set.length - 1]!.problem_id;
    const pick = await pickProblem(env, weekIds[2]!, 1, 2);
    expect(pick?.id).toBe(remaining);
  });
});
