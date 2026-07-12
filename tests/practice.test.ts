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
  await createCohort(env, 'Practice Cohort', [2026, 9, 14]);
});

describe('participant practice problems', () => {
  it('requires a participant session and always returns every mapped practice set', async () => {
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
      cohort: { name: 'Practice Cohort' },
      currentRound: null,
      rounds: expect.arrayContaining([
        expect.objectContaining({ round: 1, programWeeks: [2, 3] }),
        expect.objectContaining({ round: 2, programWeeks: [4, 5] }),
        expect.objectContaining({ round: 3, programWeeks: [6, 7] }),
      ]),
      problems: expect.arrayContaining([
        expect.objectContaining({ number: 739, title: 'Daily Temperatures' }),
        expect.objectContaining({ number: 11, title: 'Container With Most Water' }),
        expect.objectContaining({ number: 3070 }),
        expect.objectContaining({ round: 2, number: 875 }),
      ]),
    });

  });

  it('returns the same complete library to organizers', async () => {
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
      problems: expect.arrayContaining([
        expect.objectContaining({ round: 1, number: 739 }),
        expect.objectContaining({ round: 2, number: 875 }),
        expect.objectContaining({ round: 2, number: 146 }),
        expect.objectContaining({ round: 2, number: 567 }),
      ]),
    });
  });
});
