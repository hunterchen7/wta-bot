import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapGuild } from '../src/engine/bootstrap';

afterEach(() => vi.unstubAllGlobals());

function stubDiscord() {
  const calls: Array<{ method: string; url: string; body: any }> = [];
  let n = 0;
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://discord.com/')) return realFetch(input as any, init);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method: init?.method ?? 'GET', url, body });
    n++;
    return Promise.resolve(
      new Response(JSON.stringify({ id: `id-${n}`, type: body?.type ?? 0 }), { status: 200 }),
    );
  });
  return calls;
}

describe('annual bootstrap', () => {
  it('creates roles/category/channels private-first, saves settings, queues panel + summary', async () => {
    // Pretend last year is configured — bootstrap must NOT touch it
    await env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES
       ('announce_channel_id', 'old-announce'), ('start_here_channel_id', 'old-start')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();

    const calls = stubDiscord();
    await bootstrapGuild(
      { ...env, DISCORD_TOKEN: 't', DISCORD_APP_ID: 'botid' } as any,
      { guildId: 'G1', year: 2026, interactionToken: 'itok' },
    );

    // creation-only: previous channels are never touched
    const locks = calls.filter((c) => c.method === 'PUT' || c.method === 'PATCH');
    expect(locks).toHaveLength(0);

    // three roles created (none were configured)
    const roles = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/guilds/G1/roles'));
    expect(roles.map((r) => r.body.name).sort()).toEqual(['Member', 'Organizer', 'Participant']);

    // category + five channels
    const channels = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/guilds/G1/channels'));
    expect(channels).toHaveLength(6);
    expect(channels[0]!.body).toMatchObject({ name: 'WTA 2026', type: 4 });
    const names = channels.slice(1).map((c) => c.body.name).sort();
    expect(names).toEqual(['announcements', 'interviews', 'introductions', 'start-here', 'wta-organizers']);
    // private-first: every channel (incl. start-here) denies @everyone view
    // and has no Member/Participant allows yet
    for (const ch of channels.slice(1)) {
      const everyone = ch.body.permission_overwrites.find((o: any) => o.id === 'G1');
      expect(everyone.deny).toBe('1024');
      const memberish = ch.body.permission_overwrites.filter(
        (o: any) => o.type === 0 && o.id !== 'G1' && ch.body.name !== 'wta-organizers' && ch.body.name !== 'interviews',
      );
      // only the organizer role may appear
      expect(memberish.length).toBeLessThanOrEqual(1);
    }

    // settings now point at the new ids
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN
       ('announce_channel_id','start_here_channel_id','threads_channel_id','organizer_channel_id','intro_channel_id','member_role_id','participant_role_id','organizer_role_id','category_id')`,
    ).all<any>();
    expect(results).toHaveLength(9);
    for (const r of results) expect(String(r.value)).toMatch(/^id-/);

    // verify panel + followup summary queued
    const panel = await env.DB.prepare(
      "SELECT count(*) AS n FROM outbox WHERE kind = 'channel_msg' AND payload LIKE '%verify:start%'",
    ).first<any>();
    expect(panel.n).toBe(1);
    const followup = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'followup' ORDER BY id DESC LIMIT 1",
    ).first<any>();
    expect(JSON.parse(followup.payload).message.content).toContain('private/testing mode');
  });

  it('reports a helpful failure instead of retrying when permissions are missing', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://discord.com/')) return realFetch(input as any, init);
      return Promise.resolve(new Response('{"message":"Missing Permissions"}', { status: 403 }));
    });
    await bootstrapGuild(
      { ...env, DISCORD_TOKEN: 't', DISCORD_APP_ID: 'botid' } as any,
      { guildId: 'G2', year: 2027, interactionToken: 'itok2' },
    );
    const followup = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'followup' ORDER BY id DESC LIMIT 1",
    ).first<any>();
    expect(JSON.parse(followup.payload).message.content).toContain('Manage Channels');
  });
});


describe('publish', () => {
  it('flips every configured channel to member-facing permissions', async () => {
    const calls: Array<{ method: string; url: string; body: any }> = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://discord.com/')) return realFetch(input as any, init);
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return Promise.resolve(new Response('{"id":"x"}', { status: 200 }));
    });
    const { publishGuild } = await import('../src/engine/bootstrap');
    await publishGuild(
      { ...env, DISCORD_TOKEN: 't', DISCORD_APP_ID: 'botid' } as any,
      { guildId: 'G1', interactionToken: 'ptok' },
    );
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(5);
    // start-here becomes @everyone-visible
    const startHereId = (await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'start_here_channel_id'",
    ).first<any>()).value;
    const sh = patches.find((p) => p.url.endsWith(`/channels/${startHereId}`))!;
    const everyone = sh.body.permission_overwrites.find((o: any) => o.id === 'G1');
    expect(everyone.allow).toBe(String(1024 + 65536));
    const followup = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'followup' ORDER BY id DESC LIMIT 1",
    ).first<any>();
    expect(JSON.parse(followup.payload).message.content).toContain('Live!');
  });
});
