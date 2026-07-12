import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapGuild, publishGuild } from '../src/engine/bootstrap';

afterEach(() => vi.unstubAllGlobals());

type Call = { method: string; url: string; body: any };

function stubDiscord(failNonWebhook = false) {
  const calls: Call[] = [];
  let n = 0;
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://discord.com/')) return realFetch(input as any, init);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method: init?.method ?? 'GET', url, body });
    if (failNonWebhook && !url.includes('/webhooks/')) {
      return Promise.resolve(new Response('{"message":"Missing Permissions"}', { status: 403 }));
    }
    n++;
    return Promise.resolve(
      new Response(JSON.stringify({ id: `id-${n}`, type: body?.type ?? 0 }), { status: 200 }),
    );
  });
  return calls;
}

const followupOf = (calls: Call[]) =>
  calls.filter((c) => c.url.includes('/webhooks/') && c.method === 'PATCH').map((c) => c.body.content);

describe('annual bootstrap', () => {
  it('creates roles/category/channels private-first, saves settings, posts panel + summary immediately', async () => {
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

    // creation-only: previous channels never touched (webhook edit is the only PATCH)
    const mutations = calls.filter(
      (c) => (c.method === 'PUT' || c.method === 'PATCH') && !c.url.includes('/webhooks/'),
    );
    expect(mutations).toHaveLength(0);

    // three roles created (none were configured)
    const roles = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/guilds/G1/roles'));
    expect(roles.map((r) => r.body.name).sort()).toEqual(['Member', 'Organizer', 'Participant']);

    // category + five channels, all private-first
    const channels = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/guilds/G1/channels'));
    expect(channels).toHaveLength(6);
    expect(channels[0]!.body).toMatchObject({ name: 'WTA 2026', type: 4 });
    for (const ch of channels.slice(1)) {
      const everyone = ch.body.permission_overwrites.find((o: any) => o.id === 'G1');
      expect(everyone.deny, ch.body.name).toBe('1024');
    }

    // settings point at the new ids
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN
       ('announce_channel_id','start_here_channel_id','threads_channel_id','organizer_channel_id','intro_channel_id','member_role_id','participant_role_id','organizer_role_id','category_id')`,
    ).all<any>();
    expect(results).toHaveLength(9);
    for (const r of results) expect(String(r.value)).toMatch(/^id-/);

    // verify panel posted directly into the new start-here
    const startHere = (await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'start_here_channel_id'",
    ).first<any>())!.value;
    const panel = calls.find(
      (c) => c.method === 'POST' && c.url.endsWith(`/channels/${startHere}/messages`),
    );
    expect(JSON.stringify(panel?.body)).toContain('verify:start');

    // deferred response edited immediately with the summary
    const followups = followupOf(calls);
    expect(followups.join('')).toContain('private/testing mode');
  });

  it('reports a helpful failure immediately instead of retrying', async () => {
    const calls = stubDiscord(true);
    await bootstrapGuild(
      { ...env, DISCORD_TOKEN: 't', DISCORD_APP_ID: 'botid' } as any,
      { guildId: 'G2', year: 2027, interactionToken: 'itok2' },
    );
    expect(followupOf(calls).join('')).toContain('Manage Channels');
  });
});

describe('publish', () => {
  it('flips every configured channel to member-facing permissions', async () => {
    const calls = stubDiscord();
    await publishGuild(
      { ...env, DISCORD_TOKEN: 't', DISCORD_APP_ID: 'botid' } as any,
      { guildId: 'G1', interactionToken: 'ptok' },
    );
    const patches = calls.filter((c) => c.method === 'PATCH' && !c.url.includes('/webhooks/'));
    expect(patches).toHaveLength(5);

    const startHereId = (await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'start_here_channel_id'",
    ).first<any>())!.value;
    const sh = patches.find((p) => p.url.endsWith(`/channels/${startHereId}`))!;
    const everyone = sh.body.permission_overwrites.find((o: any) => o.id === 'G1');
    expect(everyone.allow).toBe(String(1024 + 65536));

    expect(followupOf(calls).join('')).toContain('Live!');
  });
});
