import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inboxScan } from '../src/engine/inbox';

afterEach(() => vi.unstubAllGlobals());

// Discord returns channel messages newest-first.
const stubMessages = (messages: unknown[]) => {
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/channels/chan-1/messages')) {
      // Honour ?after= so a re-poll returns nothing new.
      const after = new URL(url).searchParams.get('after');
      const fresh = after ? messages.filter((m: any) => Number(m.id) > Number(after)) : messages;
      return Promise.resolve(new Response(JSON.stringify(fresh), { status: 200 }));
    }
    return real(input as any, init);
  });
};

describe('inboxScan', () => {
  it('stores student replies, ignores the bot, advances the cursor, and dedupes', async () => {
    await env.DB.prepare(
      `INSERT INTO participants (id, discord_id, name, status, dm_channel_id)
       VALUES (7701, 'stud-7701', 'DM Student', 'active', 'chan-1')`,
    ).run();

    stubMessages([
      { id: '30', content: 'and one more thing', timestamp: '2026-07-14T10:03:00Z', author: { id: 'stud-7701' } },
      { id: '20', content: 'this is from the bot', timestamp: '2026-07-14T10:02:00Z', author: { id: 'bot-1', bot: true } },
      { id: '10', content: "I can't make my session", timestamp: '2026-07-14T10:01:00Z', author: { id: 'stud-7701' } },
    ]);

    const stored = await inboxScan({ ...env, DISCORD_TOKEN: 't' } as any, new Date('2026-07-14T10:05:00Z'));
    expect(stored).toBe(2);

    const rows = await env.DB.prepare(
      'SELECT content, discord_message_id FROM inbox_messages WHERE participant_id = 7701 ORDER BY id',
    ).all<{ content: string; discord_message_id: string }>();
    expect(rows.results.map((r) => r.content)).toEqual(["I can't make my session", 'and one more thing']);
    expect(rows.results.some((r) => r.content.includes('from the bot'))).toBe(false);

    const p = await env.DB.prepare('SELECT dm_last_seen_id, dm_last_polled_at FROM participants WHERE id = 7701')
      .first<{ dm_last_seen_id: string; dm_last_polled_at: string }>();
    expect(p?.dm_last_seen_id).toBe('30'); // advanced past every message, incl. the bot's
    expect(p?.dm_last_polled_at).not.toBeNull();

    // Re-poll: cursor honoured, nothing new, no duplicate rows.
    const again = await inboxScan({ ...env, DISCORD_TOKEN: 't' } as any, new Date('2026-07-14T10:20:00Z'));
    expect(again).toBe(0);
    const count = await env.DB.prepare('SELECT count(*) AS n FROM inbox_messages WHERE participant_id = 7701')
      .first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it('skips participants without a DM channel and marks broken channels polled', async () => {
    await env.DB.prepare(
      `INSERT INTO participants (id, discord_id, name, status, dm_channel_id)
       VALUES (7702, 'stud-7702', 'No Channel', 'active', NULL),
              (7703, 'stud-7703', 'Broken Channel', 'active', 'chan-1')`,
    ).run();
    // Force the channel fetch to fail for 7703's poll.
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/channels/chan-1/messages')) return Promise.resolve(new Response('nope', { status: 403 }));
      return real(input as any, init);
    });
    await inboxScan({ ...env, DISCORD_TOKEN: 't' } as any, new Date('2026-07-14T11:00:00Z'));
    const broken = await env.DB.prepare('SELECT dm_last_polled_at FROM participants WHERE id = 7703').first<any>();
    expect(broken?.dm_last_polled_at).not.toBeNull(); // marked so rotation continues
  });
});
