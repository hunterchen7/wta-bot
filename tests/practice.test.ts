import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCohort } from '../src/engine/weeks';
import { signToken } from '../src/forms/token';
import { app } from '../src/index';

const PARTICIPANT_ID = 77501;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO participants (id, discord_id, name, preferred_email, topics, status)
     VALUES (?1, 'practice-77501', 'Practice Student', 'practice@example.com', '["dsa"]', 'active')`,
  ).bind(PARTICIPANT_ID).run();
  const cohort = await createCohort(env, 'Practice Cohort', [2026, 9, 14]);
  await env.DB.prepare(
    `UPDATE weeks SET match_at = ?2, reports_due_at = ?3 WHERE id = ?1`,
  ).bind(cohort.weeks[0]!.id, new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 86400_000).toISOString()).run();
});

describe('participant practice problems', () => {
  it('requires a participant session and returns the current round set', async () => {
    expect((await app.request('/api/practice', {}, env)).status).toBe(401);
    const token = await signToken(
      env.FORM_SIGNING_SECRET!,
      `sess:${PARTICIPANT_ID}:0`,
      new Date(Date.now() + 60_000),
    );
    const response = await app.request('/api/practice', {
      headers: { Cookie: `wta_sess=${token}` },
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({
      organizer: false,
      cohort: { name: 'Practice Cohort' },
      round: 1,
      problems: expect.arrayContaining([
        expect.objectContaining({ number: 739, title: 'Daily Temperatures' }),
        expect.objectContaining({ number: 11, title: 'Container With Most Water' }),
        expect.objectContaining({ number: 3070 }),
      ]),
    });

    await env.DB.prepare('UPDATE weeks SET match_at = ?2 WHERE idx = ?1').bind(1, new Date(Date.now() + 86400_000).toISOString()).run();
    const locked = await app.request('/api/practice', { headers: { Cookie: `wta_sess=${token}` } }, env);
    expect(await locked.json<any>()).toMatchObject({ organizer: false, round: null, problems: [] });
  });

  it('returns every week to organizers', async () => {
    const token = await signToken(
      env.FORM_SIGNING_SECRET!,
      `sess:${PARTICIPANT_ID}:1`,
      new Date(Date.now() + 60_000),
    );
    const response = await app.request('/api/practice', {
      headers: { Cookie: `wta_sess=${token}` },
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({
      organizer: true,
      problems: expect.arrayContaining([
        expect.objectContaining({ round: 1, number: 739 }),
        expect.objectContaining({ round: 2, number: 875 }),
        expect.objectContaining({ round: 2, number: 146 }),
        expect.objectContaining({ round: 2, number: 567 }),
      ]),
    });
  });
});
