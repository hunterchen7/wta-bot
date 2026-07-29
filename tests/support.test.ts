import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSetting } from '../src/config';
import { supportPanelMessage } from '../src/discord/support';
import { executeOutbox } from '../src/engine/executor';
import { supportOverwrites } from '../src/engine/support';
import { asUser, makeSigner, sendInteraction } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('support threads', () => {
  it('explains privacy without exposing fallback implementation details', () => {
    expect(supportPanelMessage().content).toContain(
      'Support threads are private and visible only to you and WTA organizers.',
    );
    expect(supportPanelMessage().content).not.toContain('whenever Discord permits');
    expect(supportPanelMessage().content).not.toContain('participant-only');
  });

  it('queues one private support thread per requester', async () => {
    const signer = await makeSigner();
    await env.DB.prepare(
      `INSERT INTO participants (discord_id, discord_username, name, preferred_email, status)
       VALUES ('support-user', 'support-user', 'Support User', 'support@example.com', 'active')`,
    ).run();
    await setSetting(env, 'support_channel_id', 'support-channel');

    const interaction = {
      type: 3,
      id: 'support-interaction',
      token: 'support-token',
      guild_id: 'guild',
      data: { custom_id: 'support:create', component_type: 2 },
      ...asUser('support-user'),
    };
    const response = await sendInteraction(signer, interaction, {
      DISCORD_TOKEN: undefined,
      ALLOWED_GUILD_IDS: 'guild',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
    const ticket = await env.DB.prepare(
      "SELECT discord_id, status FROM support_threads WHERE discord_id = 'support-user'",
    ).first();
    expect(ticket).toEqual({ discord_id: 'support-user', status: 'pending' });
    const row = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'support_thread_create' ORDER BY id DESC LIMIT 1",
    ).first<{ payload: string }>();
    expect(JSON.parse(row!.payload)).toMatchObject({
      channelId: 'support-channel',
      userId: 'support-user',
      displayName: 'Support User',
      interactionToken: 'support-token',
    });

    const duplicate = await sendInteraction(signer, {
      ...interaction,
      id: 'support-interaction-2',
      token: 'support-token-2',
    }, {
      DISCORD_TOKEN: undefined,
      ALLOWED_GUILD_IDS: 'guild',
    });
    const duplicateBody = await duplicate.json() as { data: { content: string } };
    expect(duplicateBody.data.content).toContain('already being created');
  });

  it('creates a private thread, adds the requester, and completes the deferred response', async () => {
    const inserted = await env.DB.prepare(
      "INSERT INTO support_threads (discord_id, status) VALUES ('executor-user', 'pending')",
    ).run();
    const ticketId = Number(inserted.meta.last_row_id);
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const url = String(input instanceof Request ? input.url : input);
      calls.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes('/threads')) return Promise.resolve(Response.json({ id: 'private-support-thread' }));
      return Promise.resolve(Response.json({ id: 'message' }));
    });

    await executeOutbox(
      { ...env, DISCORD_TOKEN: 'token', DISCORD_APP_ID: 'app' } as any,
      'support_thread_create',
      {
        ticketId,
        channelId: 'support-channel',
        userId: 'executor-user',
        displayName: 'Executor User',
        interactionToken: 'interaction-token',
      },
    );

    expect(calls.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'POST', url: 'https://discord.com/api/v10/channels/support-channel/threads' },
      { method: 'PUT', url: 'https://discord.com/api/v10/channels/private-support-thread/thread-members/executor-user' },
      { method: 'POST', url: 'https://discord.com/api/v10/channels/private-support-thread/messages' },
      { method: 'PATCH', url: 'https://discord.com/api/v10/webhooks/app/interaction-token/messages/@original' },
    ]);
    expect(await env.DB.prepare(
      'SELECT thread_id, visibility, status FROM support_threads WHERE id = ?1',
    ).bind(ticketId).first()).toEqual({
      thread_id: 'private-support-thread',
      visibility: 'private',
      status: 'open',
    });
  });

  it('can add an organizer to an existing private thread through the outbox executor', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url: String(input instanceof Request ? input.url : input),
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await executeOutbox(
      { ...env, DISCORD_TOKEN: 'token' } as any,
      'thread_member_add',
      { threadId: 'session-thread', userId: 'organizer-user' },
    );

    expect(calls).toEqual([{
      method: 'PUT',
      url: 'https://discord.com/api/v10/channels/session-thread/thread-members/organizer-user',
    }]);
  });

  it('can remove a member and rename an existing private thread through the bot', async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url: String(input instanceof Request ? input.url : input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await executeOutbox(
      { ...env, DISCORD_TOKEN: 'token' } as any,
      'thread_member_remove',
      { threadId: 'session-thread', userId: 'former-member' },
    );
    await executeOutbox(
      { ...env, DISCORD_TOKEN: 'token' } as any,
      'thread_rename',
      { threadId: 'session-thread', name: 'r1 re-pair · Hunter → Cole' },
    );

    expect(calls).toEqual([
      {
        method: 'DELETE',
        url: 'https://discord.com/api/v10/channels/session-thread/thread-members/former-member',
        body: undefined,
      },
      {
        method: 'PATCH',
        url: 'https://discord.com/api/v10/channels/session-thread',
        body: { name: 'r1 re-pair · Hunter → Cole' },
      },
    ]);
  });

  it('keeps the fallback channel participant-only', () => {
    expect(supportOverwrites('guild', 'participant', 'organizer', 'bot')).toEqual([
      { id: 'guild', type: 0, deny: '1024' },
      {
        id: 'participant',
        type: 0,
        allow: '274877973504',
        deny: '103079217152',
      },
      {
        id: 'organizer',
        type: 0,
        allow: '395137059840',
      },
      {
        id: 'bot',
        type: 1,
        allow: '395137059840',
      },
    ]);
  });
});
