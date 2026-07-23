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
  it('creates program roles/category/channels private-first and leaves Discord verification native', async () => {
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

    // only program roles are created; there is no bot-managed Member role
    const roles = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/guilds/G1/roles'));
    expect(roles.map((r) => r.body.name).sort()).toEqual(['Organizer', 'Participant']);

    // category + four program channels, all private-first
    const channels = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/guilds/G1/channels'));
    expect(channels).toHaveLength(5);
    expect(channels[0]!.body).toMatchObject({ name: 'WTA 2026', type: 4 });
    for (const ch of channels.slice(1)) {
      const everyone = ch.body.permission_overwrites.find((o: any) => o.id === 'G1');
      expect(everyone.deny, ch.body.name).toBe('1024');
    }

    // settings point at the new ids
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN
       ('announce_channel_id','pairing_channel_id','threads_channel_id','organizer_channel_id','participant_role_id','organizer_role_id','category_id')`,
    ).all<any>();
    expect(results).toHaveLength(7);
    for (const r of results) expect(String(r.value)).toMatch(/^id-/);
    expect(calls.some((call) => JSON.stringify(call.body).includes('verify:start'))).toBe(false);

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
  it('flips every configured program channel to live permissions', async () => {
    const calls = stubDiscord();
    await publishGuild(
      { ...env, DISCORD_TOKEN: 't', DISCORD_APP_ID: 'botid' } as any,
      { guildId: 'G1', interactionToken: 'ptok' },
    );
    const patches = calls.filter((c) => c.method === 'PATCH' && !c.url.includes('/webhooks/'));
    expect(patches).toHaveLength(4);

    const announcementsId = (await env.DB.prepare("SELECT value FROM settings WHERE key = 'announce_channel_id'").first<any>())!.value;
    const announcements = patches.find((patch) => patch.url.endsWith(`/channels/${announcementsId}`))!;
    const everyone = announcements.body.permission_overwrites.find((overwrite: any) => overwrite.id === 'G1');
    expect(everyone.allow).toBe(String(1024 + 65536));

    const pairingId = (await env.DB.prepare("SELECT value FROM settings WHERE key = 'pairing_channel_id'").first<any>())!.value;
    const pairing = patches.find((patch) => patch.url.endsWith(`/channels/${pairingId}`))!;
    const pairingEveryone = pairing.body.permission_overwrites.find((overwrite: any) => overwrite.id === 'G1');
    const participantId = (await env.DB.prepare("SELECT value FROM settings WHERE key = 'participant_role_id'").first<any>())!.value;
    const pairingParticipant = pairing.body.permission_overwrites.find((overwrite: any) => overwrite.id === participantId);
    expect(pairingEveryone.deny).toBe('1024');
    expect(pairingParticipant).toMatchObject({ allow: String(1024 + 65536), deny: String(2048) });

    expect(followupOf(calls).join('')).toContain('Live!');
  });

  it('creates the participant-only pairing channel when upgrading an existing guild', async () => {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'pairing_channel_id'").run();
    const calls = stubDiscord();

    await publishGuild(
      { ...env, DISCORD_TOKEN: 't', DISCORD_APP_ID: 'botid' } as any,
      { guildId: 'G1', interactionToken: 'migration-token' },
    );

    const created = calls.find((call) => call.method === 'POST' && call.url.endsWith('/guilds/G1/channels'));
    expect(created?.body).toMatchObject({ name: 'pairing', type: 0 });
    const everyone = created!.body.permission_overwrites.find((overwrite: any) => overwrite.id === 'G1');
    expect(everyone.deny).toBe('1024');
    const stored = await env.DB.prepare("SELECT value FROM settings WHERE key = 'pairing_channel_id'").first<{ value: string }>();
    expect(stored?.value).toMatch(/^id-/);
  });
});
