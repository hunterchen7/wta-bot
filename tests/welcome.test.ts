import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { provisionWelcome, refreshWelcomeMessage } from '../src/engine/welcome';

type Call = { method: string; url: string; body: any };

afterEach(() => vi.unstubAllGlobals());

function stubDiscord() {
  const calls: Call[] = [];
  const channels: Array<{ id: string; name: string; type: number }> = [];
  let nextChannel = 1;
  let nextMessage = 1;
  const realFetch = globalThis.fetch;

  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://discord.com/')) return realFetch(input as any, init);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    if (method === 'GET' && url.endsWith('/guilds/G1/channels')) {
      return Promise.resolve(Response.json(channels));
    }
    if (method === 'GET' && url.endsWith('/guilds/G1/onboarding')) {
      return Promise.resolve(Response.json({
        enabled: true,
        mode: 1,
        prompts: [{ id: 'existing-prompt' }],
        default_channel_ids: ['existing-default'],
      }));
    }
    if (method === 'POST' && url.endsWith('/guilds/G1/channels')) {
      const channel = { id: `channel-${nextChannel++}`, name: body.name, type: body.type };
      channels.push(channel);
      return Promise.resolve(Response.json(channel));
    }
    if (method === 'POST' && /\/channels\/channel-\d+\/messages$/.test(url)) {
      return Promise.resolve(Response.json({ id: `message-${nextMessage++}` }));
    }
    return Promise.resolve(Response.json({ id: 'ok' }));
  });
  return calls;
}

describe('new-member welcome provisioning', () => {
  it('refreshes the existing Start Here panel through the bot API', async () => {
    await env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES
       ('start_here_channel_id', 'start-channel'),
       ('start_here_message_id', 'start-message')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
    const calls: Call[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({
        method: init?.method ?? 'GET',
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Promise.resolve(Response.json({ id: 'start-message' }));
    });

    await refreshWelcomeMessage({ ...env, DISCORD_TOKEN: 'token' } as any);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: 'https://discord.com/api/v10/channels/start-channel/messages/start-message',
      body: {
        content: expect.stringContaining('follow the link to complete the enrolment'),
      },
    });
    expect(calls[0]!.body.content).not.toContain('/join');
  });

  it('creates the rules and CTA once, enables the welcome screen, and is safe to rerun', async () => {
    await env.DB.prepare(
      `DELETE FROM settings WHERE key IN
       ('rules_channel_id','start_here_channel_id','rules_message_id','start_here_message_id','announce_channel_id')`,
    ).run();
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('organizer_role_id', 'organizer') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    const calls = stubDiscord();
    const testEnv = { ...env, DISCORD_TOKEN: 'token', DISCORD_APP_ID: 'bot' } as any;

    await provisionWelcome(testEnv, { guildId: 'G1', interactionToken: 'first' });
    await provisionWelcome(testEnv, { guildId: 'G1', interactionToken: 'second' });

    const channelCreates = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/guilds/G1/channels'));
    expect(channelCreates).toHaveLength(2);
    expect(channelCreates.map((call) => call.body.name)).toEqual(['rules', 'start-here']);
    expect(channelCreates[0]!.body.permission_overwrites).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'G1', deny: '2048' }),
      expect.objectContaining({ id: 'organizer' }),
      expect.objectContaining({ id: 'bot' }),
    ]));

    const newMessages = calls.filter((call) => call.method === 'POST' && /\/channels\/channel-\d+\/messages$/.test(call.url));
    expect(newMessages).toHaveLength(2);
    expect(newMessages.some((call) => call.body.content.includes('WTA community rules'))).toBe(true);
    expect(newMessages.some((call) => call.body.components?.[0]?.components?.[0]?.label === 'Join WTA')).toBe(true);

    const messageEdits = calls.filter((call) => call.method === 'PATCH' && /\/channels\/channel-\d+\/messages\/message-\d+$/.test(call.url));
    expect(messageEdits).toHaveLength(2);

    const welcomeUpdates = calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/guilds/G1/welcome-screen'));
    expect(welcomeUpdates).toHaveLength(2);
    expect(welcomeUpdates[0]!.body).toMatchObject({
      enabled: true,
      welcome_channels: [
        expect.objectContaining({ description: 'Start here: join WTA 2026' }),
        expect.objectContaining({ description: 'Read the community rules' }),
      ],
    });
    const onboardingUpdates = calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/guilds/G1/onboarding'));
    expect(onboardingUpdates).toHaveLength(2);
    expect(onboardingUpdates[0]!.body).toMatchObject({
      enabled: true,
      mode: 1,
      prompts: [{ id: 'existing-prompt' }],
      default_channel_ids: ['channel-2', 'channel-1', 'existing-default'],
    });

    const followups = calls.filter((call) => call.method === 'PATCH' && call.url.includes('/webhooks/'));
    expect(followups).toHaveLength(2);
    expect(followups[0]!.body.content).toContain('welcome path is live');
  });

  it('returns an actionable permissions error', async () => {
    const realFetch = globalThis.fetch;
    const calls: Call[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://discord.com/')) return realFetch(input as any, init);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url.includes('/webhooks/')) return Promise.resolve(Response.json({}));
      return Promise.resolve(new Response('{"message":"Missing Permissions"}', { status: 403 }));
    });

    await provisionWelcome(
      { ...env, DISCORD_TOKEN: 'token', DISCORD_APP_ID: 'bot' } as any,
      { guildId: 'G2', interactionToken: 'failure' },
    );
    const followup = calls.find((call) => call.url.includes('/webhooks/'));
    expect(followup?.body.content).toContain('Manage Server');
    expect(followup?.body.content).toContain('Community enabled');
  });
});
