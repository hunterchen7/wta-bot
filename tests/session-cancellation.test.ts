import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeOutbox } from '../src/engine/executor';
import { reportIncident } from '../src/engine/incidents';
import { closeStaleSessionThreads } from '../src/engine/session-thread';
import { createCohort } from '../src/engine/weeks';

afterEach(() => vi.unstubAllGlobals());

describe('session cancellation cleanup', () => {
  it('directly informs the affected partner and queues the old thread for closure', async () => {
    const { weeks } = await createCohort(env, 'Cancellation test', [2026, 9, 14]);
    const week = weeks[0]!;
    const canceler = await insertParticipant('cancel-user', 'Canceling Partner');
    const victim = await insertParticipant('victim-user', 'Affected Partner');
    const inserted = await env.DB.prepare(
      `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, thread_id, state)
       VALUES (?1, ?2, ?3, 'thread-123', 'scheduled')`,
    ).bind(week.id, canceler, victim).run();
    const sessionId = Number(inserted.meta.last_row_id);

    const result = await reportIncident(env, {
      id: sessionId,
      week_id: week.id,
      interviewer_id: canceler,
      interviewee_id: victim,
      thread_id: 'thread-123',
      state: 'scheduled',
      origin: 'match',
      scheduled_at: '2026-09-16T23:30:00.000Z',
      packet_sent_at: null,
    }, 'late_cancel', 'cancel-user');

    expect(result).toMatchObject({ ok: true });
    expect(await env.DB.prepare('SELECT state FROM sessions WHERE id = ?1').bind(sessionId).first()).toEqual({ state: 'broken' });
    const { results } = await env.DB.prepare(
      'SELECT kind, payload FROM outbox ORDER BY id',
    ).all<{ kind: string; payload: string }>();
    const rows = results.map((row) => ({ kind: row.kind, payload: JSON.parse(row.payload) }));

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'thread_close',
        payload: expect.objectContaining({
          channelId: 'thread-123',
          name: 'cancelled · Canceling Partner → Affected Partner',
          message: expect.objectContaining({ content: expect.stringContaining('priority re-pairing') }),
        }),
      }),
      expect.objectContaining({
        kind: 'dm',
        payload: expect.objectContaining({
          userId: 'victim-user',
          message: expect.objectContaining({
            content: expect.stringContaining('I’ll message you again when a new partner is available'),
          }),
        }),
      }),
    ]));
  });

  it('renames, locks, and archives a closed Discord thread', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url: String(input instanceof Request ? input.url : input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Promise.resolve(Response.json({ id: 'thread-123' }));
    });

    await executeOutbox(
      { ...env, DISCORD_TOKEN: 'token' } as any,
      'thread_close',
      {
        channelId: 'thread-123',
        name: 'cancelled · A → B',
        message: { content: 'This session was cancelled.' },
      },
    );

    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://discord.com/api/v10/channels/thread-123/messages',
        body: { content: 'This session was cancelled.' },
      },
      {
        method: 'PATCH',
        url: 'https://discord.com/api/v10/channels/thread-123',
        body: { name: 'cancelled · A → B', locked: true, archived: true },
      },
    ]);
  });

  it('backfills thread closure for older broken sessions once', async () => {
    const { weeks } = await createCohort(env, 'Old cancellation test', [2027, 1, 3]);
    const interviewer = await insertParticipant('old-interviewer', 'Old Interviewer');
    const interviewee = await insertParticipant('old-interviewee', 'Old Interviewee');
    await env.DB.prepare(
      `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, thread_id, state)
       VALUES (?1, ?2, ?3, 'old-thread', 'broken')`,
    ).bind(weeks[0]!.id, interviewer, interviewee).run();

    expect(await closeStaleSessionThreads(env)).toBe(1);
    expect(await closeStaleSessionThreads(env)).toBe(0);
    const row = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'thread_close' AND json_extract(payload, '$.channelId') = 'old-thread'",
    ).first<{ payload: string }>();
    expect(JSON.parse(row!.payload)).toEqual({
      channelId: 'old-thread',
      name: 'closed · Old Interviewer → Old Interviewee',
    });
  });
});

async function insertParticipant(discordId: string, name: string) {
  const result = await env.DB.prepare(
    `INSERT INTO participants (discord_id, discord_username, name, preferred_email, status)
     VALUES (?1, ?2, ?3, ?4, 'active')`,
  ).bind(discordId, discordId, name, `${discordId}@example.com`).run();
  return Number(result.meta.last_row_id);
}
