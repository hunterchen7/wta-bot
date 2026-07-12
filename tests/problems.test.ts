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
      'INSERT INTO problems (number, title, url, difficulty, difficulty_rank) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
      .bind(number, title, `https://leetcode.com/problems/${number}`, difficulty, rank)
      .run();
  }
});

describe('problem bank', () => {
  it('generates week sets inside the difficulty bands', async () => {
    const w1 = await generateWeekSet(env, weekIds[0]!, 1, 5);
    expect(w1.chosen.length).toBe(3); // only 3 easies exist
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

  it('serves the packet page to the signed link and refuses garbage', async () => {
    const dm = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'dm' AND payload LIKE '%/p/%' ORDER BY id DESC LIMIT 1",
    ).first<any>();
    const url = new URL(JSON.parse(dm.payload).message.content.match(/https?:\/\/\S+\/p\/\S+/)![0]);
    const res = await app.request(url.pathname, {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Interviewer packet');
    expect(html).toContain('For your eyes only');

    expect((await app.request('/p/garbage', {}, env)).status).toBe(404);
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
