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

  it('collects a topic and issue before queueing one private support thread per requester', async () => {
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
    const modal = await response.json() as {
      type: number;
      data: { custom_id: string; components: unknown[] };
    };
    expect(modal.type).toBe(9);
    expect(modal.data.custom_id).toBe('support:create:submit');
    expect(modal.data.components).toHaveLength(2);

    const submitted = await sendInteraction(signer, {
      type: 5,
      id: 'support-modal',
      token: 'support-modal-token',
      guild_id: 'guild',
      data: {
        custom_id: 'support:create:submit',
        components: [
          {
            type: 18,
            component: {
              type: 4,
              custom_id: 'support-topic',
              value: 'Scheduling with my partner',
            },
          },
          {
            type: 18,
            component: {
              type: 4,
              custom_id: 'support-issue',
              value: 'We cannot find a time that works before the deadline.',
            },
          },
        ],
      },
      ...asUser('support-user'),
    }, {
      DISCORD_TOKEN: undefined,
      ALLOWED_GUILD_IDS: 'guild',
    });
    expect(await submitted.json()).toEqual({ type: 5, data: { flags: 64 } });

    const ticket = await env.DB.prepare(
      "SELECT discord_id, title, issue, status FROM support_threads WHERE discord_id = 'support-user'",
    ).first();
    expect(ticket).toEqual({
      discord_id: 'support-user',
      title: 'Scheduling with my partner',
      issue: 'We cannot find a time that works before the deadline.',
      status: 'pending',
    });
    const row = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'support_thread_create' ORDER BY id DESC LIMIT 1",
    ).first<{ payload: string }>();
    expect(JSON.parse(row!.payload)).toMatchObject({
      channelId: 'support-channel',
      guildId: 'guild',
      userId: 'support-user',
      displayName: 'Support User',
      title: 'Scheduling with my partner',
      issue: 'We cannot find a time that works before the deadline.',
      interactionToken: 'support-modal-token',
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
      `INSERT INTO support_threads (discord_id, title, issue, status)
       VALUES ('executor-user', 'Dashboard login', 'The dashboard keeps rejecting my login code.', 'pending')`,
    ).run();
    const ticketId = Number(inserted.meta.last_row_id);
    await setSetting(env, 'organizer_channel_id', 'organizer-logs');
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
        guildId: 'guild',
        userId: 'executor-user',
        displayName: 'Executor User',
        title: 'Dashboard login',
        issue: 'The dashboard keeps rejecting my login code.',
        interactionToken: 'interaction-token',
      },
    );

    expect(calls.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'POST', url: 'https://discord.com/api/v10/channels/support-channel/threads' },
      { method: 'PUT', url: 'https://discord.com/api/v10/channels/private-support-thread/thread-members/executor-user' },
      { method: 'POST', url: 'https://discord.com/api/v10/channels/private-support-thread/messages' },
      { method: 'PATCH', url: 'https://discord.com/api/v10/webhooks/app/interaction-token/messages/@original' },
    ]);
    expect(calls[0]!.body).toMatchObject({
      name: 'support · Dashboard login · Executor User',
      type: 12,
    });
    expect(calls[2]!.body).toMatchObject({
      content: expect.stringContaining('## Dashboard login\nThe dashboard keeps rejecting my login code.'),
      components: [{
        type: 1,
        components: [expect.objectContaining({
          custom_id: `support:${ticketId}:close`,
          label: 'Close ticket',
        })],
      }],
    });
    expect(await env.DB.prepare(
      'SELECT thread_id, visibility, status FROM support_threads WHERE id = ?1',
    ).bind(ticketId).first()).toEqual({
      thread_id: 'private-support-thread',
      visibility: 'private',
      status: 'open',
    });
    const organizerNotice = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'channel_msg' ORDER BY id DESC LIMIT 1",
    ).first<{ payload: string }>();
    expect(JSON.parse(organizerNotice!.payload)).toEqual({
      channelId: 'organizer-logs',
      message: {
        content:
          `🛟 **New support thread** · Ticket #${ticketId} · Dashboard login\n` +
          '**Executor User** (<@executor-user>)\n' +
          'https://discord.com/channels/guild/private-support-thread',
        allowed_mentions: { parse: [] },
      },
    });
  });

  it('lets the requester close a ticket and immediately open another', async () => {
    const signer = await makeSigner();
    await env.DB.prepare(
      `INSERT INTO participants (discord_id, discord_username, name, preferred_email, status)
       VALUES ('ticket-owner', 'ticket-owner', 'Ticket Owner', 'owner@example.com', 'active')`,
    ).run();
    await setSetting(env, 'support_channel_id', 'support-channel');
    const inserted = await env.DB.prepare(
      `INSERT INTO support_threads (discord_id, thread_id, visibility, title, issue, status)
       VALUES ('ticket-owner', 'support-thread', 'private', 'Old issue', 'This issue has been resolved.', 'open')`,
    ).run();
    const ticketId = Number(inserted.meta.last_row_id);

    const closed = await sendInteraction(signer, {
      type: 3,
      id: 'support-close',
      token: 'support-close-token',
      guild_id: 'guild',
      channel_id: 'support-thread',
      data: { custom_id: `support:${ticketId}:close`, component_type: 2 },
      ...asUser('ticket-owner'),
    }, { DISCORD_TOKEN: undefined, ALLOWED_GUILD_IDS: 'guild' });
    const closedBody = await closed.json() as { data: { content: string } };
    expect(closedBody.data.content).toContain('Ticket closed');
    expect(await env.DB.prepare(
      'SELECT status, closed_at IS NOT NULL AS has_closed_at FROM support_threads WHERE id = ?1',
    ).bind(ticketId).first()).toEqual({ status: 'closed', has_closed_at: 1 });
    const closeJob = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'thread_close' ORDER BY id DESC LIMIT 1",
    ).first<{ payload: string }>();
    expect(JSON.parse(closeJob!.payload)).toMatchObject({
      channelId: 'support-thread',
      name: 'support · Old issue · closed',
    });

    const reopened = await sendInteraction(signer, {
      type: 3,
      id: 'support-open-again',
      token: 'support-open-again-token',
      guild_id: 'guild',
      data: { custom_id: 'support:create', component_type: 2 },
      ...asUser('ticket-owner'),
    }, { DISCORD_TOKEN: undefined, ALLOWED_GUILD_IDS: 'guild' });
    const reopenedBody = await reopened.json() as { type: number; data: { custom_id: string } };
    expect(reopenedBody).toMatchObject({
      type: 9,
      data: { custom_id: 'support:create:submit' },
    });
  });

  it('reconciles an archived Discord thread before opening a new ticket', async () => {
    const signer = await makeSigner();
    await env.DB.prepare(
      `INSERT INTO participants (discord_id, discord_username, name, preferred_email, status)
       VALUES ('archived-owner', 'archived-owner', 'Archived Owner', 'archived@example.com', 'active')`,
    ).run();
    await setSetting(env, 'support_channel_id', 'support-channel');
    const inserted = await env.DB.prepare(
      `INSERT INTO support_threads (discord_id, thread_id, visibility, title, issue, status)
       VALUES ('archived-owner', 'archived-thread', 'private', 'Archived issue', 'The old request was archived.', 'open')`,
    ).run();
    const ticketId = Number(inserted.meta.last_row_id);
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/channels/archived-thread')) {
        return Promise.resolve(Response.json({ thread_metadata: { archived: true } }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const response = await sendInteraction(signer, {
      type: 3,
      id: 'support-after-archive',
      token: 'support-after-archive-token',
      guild_id: 'guild',
      data: { custom_id: 'support:create', component_type: 2 },
      ...asUser('archived-owner'),
    }, { DISCORD_TOKEN: 'token', ALLOWED_GUILD_IDS: 'guild' });
    const body = await response.json() as { type: number; data: { custom_id: string } };
    expect(body).toMatchObject({
      type: 9,
      data: { custom_id: 'support:create:submit' },
    });
    expect(await env.DB.prepare(
      'SELECT status, closed_at IS NOT NULL AS has_closed_at FROM support_threads WHERE id = ?1',
    ).bind(ticketId).first()).toEqual({ status: 'closed', has_closed_at: 1 });
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
