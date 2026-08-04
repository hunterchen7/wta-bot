import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { schedulingInactivityScan } from '../src/engine/scheduling-inactivity';
import { createCohort } from '../src/engine/weeks';

afterEach(() => vi.unstubAllGlobals());

describe('scheduling inactivity', () => {
  it('warns at 48 hours and only re-pairs the sole active participant at 72 hours', async () => {
    const { weeks } = await createCohort(env, 'Activity Test', [2026, 9, 1]);
    const week = weeks[0]!;
    const ids = new Map<string, number>();
    for (const discordId of ['active', 'silent', 'none-a', 'none-b', 'both-a', 'both-b', 'recover-a', 'recover-b']) {
      ids.set(discordId, await insertParticipant(discordId));
    }
    for (const discordId of ids.keys()) {
      await env.DB.prepare(
        `INSERT INTO optins (week_id, participant_id, regular_opt_in)
         VALUES (?1, ?2, 1)`,
      ).bind(week.id, ids.get(discordId)!).run();
    }

    const createdAt = '2026-08-31T23:00:00.000Z';
    await insertSession(week.id, ids.get('active')!, ids.get('silent')!, 'thread-one', createdAt);
    await insertSession(week.id, ids.get('none-a')!, ids.get('none-b')!, 'thread-none', createdAt);
    await insertSession(week.id, ids.get('both-a')!, ids.get('both-b')!, 'thread-both', createdAt);
    await insertSession(week.id, ids.get('recover-a')!, ids.get('recover-b')!, 'thread-recover', createdAt);

    const activity = new Map<string, string[]>([
      ['thread-one', ['active']],
      ['thread-none', []],
      ['thread-both', ['both-a', 'both-b']],
      ['thread-recover', ['recover-a']],
    ]);
    stubThreadMessages(activity);

    const first = await schedulingInactivityScan(
      { ...env, DISCORD_TOKEN: 'test-token' },
      new Date('2026-09-03T00:00:00.000Z'),
    );
    expect(first).toEqual({ nudged: 3, repaired: 0, skipped: 1, errors: 0 });

    const { results: nudges } = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'channel_msg' AND payload LIKE '%removed from Round%' ORDER BY id",
    ).all<{ payload: string }>();
    const messages = nudges.map((row) => JSON.parse(row.payload));
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channelId: 'thread-one',
        message: expect.objectContaining({
          content: expect.stringContaining('<@silent>'),
          allowed_mentions: { parse: [], users: ['silent'] },
        }),
      }),
      expect.objectContaining({
        channelId: 'thread-none',
        message: expect.objectContaining({
          content: expect.stringMatching(/<@none-a> <@none-b>/),
          allowed_mentions: { parse: [], users: ['none-a', 'none-b'] },
        }),
      }),
    ]));
    expect(messages.find((message) => message.channelId === 'thread-both')).toBeUndefined();

    // One previously silent participant responds during the warning window.
    activity.set('thread-recover', ['recover-a', 'recover-b']);
    const second = await schedulingInactivityScan(
      { ...env, DISCORD_TOKEN: 'test-token' },
      new Date('2026-09-04T01:00:00.000Z'),
    );
    expect(second).toEqual({ nudged: 0, repaired: 1, skipped: 3, errors: 0 });

    expect(await sessionState('thread-one')).toBe('broken');
    expect(await sessionState('thread-none')).toBe('pending_schedule');
    expect(await sessionState('thread-both')).toBe('pending_schedule');
    expect(await sessionState('thread-recover')).toBe('pending_schedule');
    expect(await env.DB.prepare(
      'SELECT reason FROM round_exclusions WHERE week_id = ?1 AND participant_id = ?2',
    ).bind(week.id, ids.get('silent')!).first()).toEqual({ reason: 'scheduling_inactivity' });
    expect(await env.DB.prepare(
      'SELECT id FROM optins WHERE week_id = ?1 AND participant_id = ?2',
    ).bind(week.id, ids.get('silent')!).first()).toBeNull();
    expect(await env.DB.prepare(
      "SELECT need, state FROM repair_queue WHERE week_id = ?1 AND participant_id = ?2",
    ).bind(week.id, ids.get('active')!).first()).toEqual({ need: 'interviewee', state: 'open' });
    expect(await env.DB.prepare(
      'SELECT participant_id FROM round_exclusions WHERE week_id = ?1 AND participant_id IN (?2, ?3, ?4, ?5)',
    ).bind(week.id, ids.get('none-a')!, ids.get('none-b')!, ids.get('recover-a')!, ids.get('recover-b')!).first()).toBeNull();
  });

  it('retries a thread when Discord activity cannot be read', async () => {
    const { weeks } = await createCohort(env, 'Activity Retry Test', [2027, 2, 1]);
    const interviewer = await insertParticipant('retry-a');
    const interviewee = await insertParticipant('retry-b');
    await insertSession(weeks[0]!.id, interviewer, interviewee, 'thread-error', '2027-01-29T00:00:00.000Z');
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ message: 'missing' }, { status: 404 })));

    expect(await schedulingInactivityScan(
      { ...env, DISCORD_TOKEN: 'test-token' },
      new Date('2027-02-01T01:00:00.000Z'),
    )).toEqual({ nudged: 0, repaired: 0, skipped: 0, errors: 1 });
    expect(await env.DB.prepare(
      'SELECT activity_nudged_at, activity_checked_at FROM sessions WHERE thread_id = ?1',
    ).bind('thread-error').first()).toEqual({ activity_nudged_at: null, activity_checked_at: null });
  });
});

async function insertParticipant(discordId: string): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO participants (discord_id, name, preferred_email, topics, status)
     VALUES (?1, ?2, ?3, '[]', 'active')`,
  ).bind(discordId, discordId, `${discordId}@example.com`).run();
  return Number(result.meta.last_row_id);
}

async function insertSession(
  weekId: number,
  interviewerId: number,
  intervieweeId: number,
  threadId: string,
  createdAt: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sessions
       (week_id, interviewer_id, interviewee_id, thread_id, state, created_at)
     VALUES (?1, ?2, ?3, ?4, 'pending_schedule', ?5)`,
  ).bind(weekId, interviewerId, intervieweeId, threadId, createdAt).run();
}

async function sessionState(threadId: string): Promise<string | undefined> {
  return (await env.DB.prepare(
    'SELECT state FROM sessions WHERE thread_id = ?1',
  ).bind(threadId).first<{ state: string }>())?.state;
}

function stubThreadMessages(activity: Map<string, string[]>): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const threadId = /\/channels\/([^/]+)\/messages/.exec(url)?.[1];
    if (!threadId || !activity.has(threadId)) {
      return Promise.resolve(Response.json({ message: 'missing' }, { status: 404 }));
    }
    return Promise.resolve(Response.json(
      activity.get(threadId)!.map((discordId, index) => ({
        id: `${threadId}-${index}`,
        content: 'scheduling message',
        timestamp: '2026-09-01T00:00:00.000Z',
        author: { id: discordId },
      })),
    ));
  });
}
