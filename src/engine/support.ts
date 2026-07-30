import { getSetting, getSettings, setSetting } from '../config';
import { buttonRow } from '../discord/components';
import { DiscordRest } from '../discord/rest';
import { supportPanelMessage } from '../discord/support';
import type { Env } from '../env';
import { enqueue } from './outbox';

const VIEW_HISTORY = 1024n | 65536n;
const SEND = 2048n;
const MANAGE_THREADS = 17179869184n;
const CREATE_PUBLIC_THREADS = 34359738368n;
const CREATE_PRIVATE_THREADS = 68719476736n;
const SEND_IN_THREADS = 274877906944n;
const bits = (...values: bigint[]) => String(values.reduce((total, value) => total | value, 0n));

type GuildChannel = { id: string; name: string; type: number; parent_id?: string | null };

export async function ensureSupportChannel(env: Env, requestedGuildId?: string): Promise<string | null> {
  if (!env.DISCORD_TOKEN) return null;
  const guildId = requestedGuildId ?? env.ALLOWED_GUILD_IDS?.split(',')[0]?.trim();
  if (!guildId) return null;

  const configuredChannel = await getSetting(env, 'support_channel_id');
  const configuredMessage = await getSetting(env, 'support_message_id');
  const rest = new DiscordRest(env.DISCORD_TOKEN);
  if (configuredChannel && configuredMessage) {
    await rest.editMessage(configuredChannel, configuredMessage, supportPanelMessage());
    return configuredChannel;
  }

  const cfg = await getSettings(env, ['participant_role_id', 'organizer_role_id', 'category_id']);
  if (!cfg.participant_role_id || !cfg.organizer_role_id) {
    throw new Error('support setup requires Participant and Organizer roles');
  }

  let channelId = configuredChannel;
  if (!channelId) {
    const channels = await rest.request<GuildChannel[]>('GET', `/guilds/${guildId}/channels`);
    const existing = channels.find((channel) =>
      channel.type === 0
      && channel.name === 'support'
      && (!cfg.category_id || channel.parent_id === cfg.category_id)
    );
    if (existing) {
      channelId = existing.id;
    } else {
      const channel = await rest.request<GuildChannel>('POST', `/guilds/${guildId}/channels`, {
        name: 'support',
        type: 0,
        topic: 'Open a support thread for private help from WTA organizers.',
        ...(cfg.category_id ? { parent_id: cfg.category_id } : {}),
        permission_overwrites: supportOverwrites(guildId, cfg.participant_role_id, cfg.organizer_role_id, env.DISCORD_APP_ID),
      });
      channelId = channel.id;
    }
    await setSetting(env, 'support_channel_id', channelId);
  }

  const message = await rest.send(channelId, supportPanelMessage());
  await setSetting(env, 'support_message_id', message.id);
  return channelId;
}

export async function createSupportThread(
  env: Env,
  payload: {
    ticketId: number;
    channelId: string;
    guildId?: string;
    userId: string;
    displayName: string;
    title: string;
    issue: string;
    interactionToken: string;
  },
): Promise<void> {
  if (!env.DISCORD_TOKEN || !env.DISCORD_APP_ID) throw new Error('Discord support is not configured');
  const existing = await env.DB.prepare(
    'SELECT thread_id, visibility FROM support_threads WHERE id = ?1',
  ).bind(payload.ticketId).first<{ thread_id: string | null; visibility: string | null }>();
  if (!existing) throw new Error(`support ticket ${payload.ticketId} does not exist`);

  let threadId = existing.thread_id;
  let visibility = existing.visibility as 'private' | 'participant' | null;
  if (!threadId) {
    const created = await new DiscordRest(env.DISCORD_TOKEN).createSupportThread(
      payload.channelId,
      supportThreadName(payload.displayName, payload.title),
      payload.userId,
      {
        content:
          `Hi <@${payload.userId}> — an organizer will respond here.\n\n` +
          `## ${payload.title}\n${payload.issue}\n\n` +
          'Please avoid sharing passwords, login codes, or other highly sensitive information.',
        components: [buttonRow([{
          id: `support:${payload.ticketId}:close`,
          label: 'Close ticket',
          style: 2,
        }])],
        allowed_mentions: { users: [payload.userId], parse: [] },
      },
    );
    threadId = created.id;
    visibility = created.private ? 'private' : 'participant';
    await env.DB.prepare(
      "UPDATE support_threads SET thread_id = ?2, visibility = ?3, status = 'open', updated_at = datetime('now') WHERE id = ?1",
    ).bind(payload.ticketId, threadId, visibility).run();

    const organizerChannelId = await getSetting(env, 'organizer_channel_id');
    if (organizerChannelId) {
      const threadLink = payload.guildId
        ? `https://discord.com/channels/${payload.guildId}/${threadId}`
        : `<#${threadId}>`;
      await enqueue(env, 'channel_msg', {
        channelId: organizerChannelId,
        message: {
          content:
            `🛟 **New support thread** · Ticket #${payload.ticketId} · ${payload.title}\n` +
            `**${payload.displayName}** (<@${payload.userId}>)\n` +
            threadLink,
          allowed_mentions: { parse: [] },
        },
      });
    }
  }

  const privacy = visibility === 'private'
    ? 'Only you and WTA organizers can see it.'
    : 'Discord private threads were unavailable, so this thread is visible to enrolled WTA participants.';
  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${env.DISCORD_APP_ID}/${payload.interactionToken}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `✅ Your support thread is ready: <#${threadId}>\n${privacy}` }),
    },
  );
  if (!response.ok) throw new Error(`support followup -> ${response.status}: ${await response.text()}`);
}

export function supportThreadName(displayName: string, title: string, closed = false): string {
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  return `${clean(displayName)} · ${clean(title)}${closed ? ' · closed' : ''}`.slice(0, 100);
}

export function supportOverwrites(
  guildId: string,
  participantRole: string,
  organizerRole: string,
  botUser?: string,
): unknown[] {
  return [
    { id: guildId, type: 0, deny: bits(1024n) },
    {
      id: participantRole,
      type: 0,
      allow: bits(VIEW_HISTORY, SEND_IN_THREADS),
      deny: bits(SEND, CREATE_PUBLIC_THREADS, CREATE_PRIVATE_THREADS),
    },
    {
      id: organizerRole,
      type: 0,
      allow: bits(VIEW_HISTORY, SEND, SEND_IN_THREADS, MANAGE_THREADS, CREATE_PUBLIC_THREADS, CREATE_PRIVATE_THREADS),
    },
    ...(botUser ? [{
      id: botUser,
      type: 1,
      allow: bits(VIEW_HISTORY, SEND, SEND_IN_THREADS, MANAGE_THREADS, CREATE_PUBLIC_THREADS, CREATE_PRIVATE_THREADS),
    }] : []),
  ];
}
