import { getSetting, setSetting } from '../config';
import { enrollmentButtonMessage, serverRulesMessage } from '../discord/enrollment';
import { DiscordRest, type MessagePayload } from '../discord/rest';
import type { Env } from '../env';

const VIEW_HISTORY = String(1024 + 65536);
const SEND = String(2048);
const VIEW_HISTORY_SEND = String(1024 + 65536 + 2048);

type GuildChannel = { id: string; name: string; type: number };
type GuildOnboarding = {
  enabled: boolean;
  mode: number;
  prompts: unknown[];
  default_channel_ids: string[];
};

async function editOriginal(env: Env, interactionToken: string, content: string): Promise<void> {
  if (!env.DISCORD_APP_ID) return;
  await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APP_ID}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch((err) => console.error('welcome followup edit failed:', err));
}

async function ensureChannel(
  env: Env,
  rest: DiscordRest,
  guildId: string,
  channels: GuildChannel[],
  options: { name: string; topic: string; setting: 'rules_channel_id' | 'start_here_channel_id' },
): Promise<{ channel: GuildChannel; created: boolean }> {
  const configured = await getSetting(env, options.setting);
  const existing = channels.find((channel) => channel.id === configured && channel.type === 0)
    ?? channels.find((channel) => channel.type === 0 && channel.name === options.name);
  if (existing) {
    await setSetting(env, options.setting, existing.id);
    return { channel: existing, created: false };
  }

  const organizerRole = await getSetting(env, 'organizer_role_id');
  const permissionOverwrites: unknown[] = [
    { id: guildId, type: 0, allow: VIEW_HISTORY, deny: SEND },
  ];
  if (organizerRole) permissionOverwrites.push({ id: organizerRole, type: 0, allow: VIEW_HISTORY_SEND });
  if (env.DISCORD_APP_ID) permissionOverwrites.push({ id: env.DISCORD_APP_ID, type: 1, allow: VIEW_HISTORY_SEND });

  const channel = await rest.request<GuildChannel>('POST', `/guilds/${guildId}/channels`, {
    name: options.name,
    type: 0,
    topic: options.topic,
    permission_overwrites: permissionOverwrites,
  });
  await setSetting(env, options.setting, channel.id);
  channels.push(channel);
  return { channel, created: true };
}

async function upsertBotMessage(
  env: Env,
  rest: DiscordRest,
  channelId: string,
  setting: 'rules_message_id' | 'start_here_message_id',
  message: MessagePayload,
): Promise<string> {
  const existing = await getSetting(env, setting);
  if (existing) {
    try {
      await rest.editMessage(channelId, existing, message);
      return existing;
    } catch {
      // The channel can survive while an organizer deletes the old panel.
    }
  }
  const posted = await rest.send(channelId, message);
  await setSetting(env, setting, posted.id);
  return posted.id;
}

/** Refresh the existing bot-owned Start Here panel without recreating channels
 * or requiring an interaction token. Intended for the durable outbox so copy
 * changes can be applied through Discord's bot API. */
export async function refreshWelcomeMessage(env: Env): Promise<void> {
  if (!env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN not configured');
  const channelId = await getSetting(env, 'start_here_channel_id');
  const messageId = await getSetting(env, 'start_here_message_id');
  if (!channelId || !messageId) throw new Error('Start Here welcome message is not configured');
  await new DiscordRest(env.DISCORD_TOKEN).editMessage(channelId, messageId, enrollmentButtonMessage());
}

/** Provision the public first-run path without relying on a Gateway process.
 * Safe to rerun: named/configured channels are reused and bot messages edited. */
export async function provisionWelcome(
  env: Env,
  payload: { guildId: string; interactionToken: string },
): Promise<void> {
  const report = (content: string) => editOriginal(env, payload.interactionToken, content);
  if (!env.DISCORD_TOKEN) {
    await report('⚠️ Welcome setup failed: `DISCORD_TOKEN` is not configured.');
    return;
  }
  const rest = new DiscordRest(env.DISCORD_TOKEN);

  try {
    const channels = await rest.request<GuildChannel[]>('GET', `/guilds/${payload.guildId}/channels`);
    const rules = await ensureChannel(env, rest, payload.guildId, channels, {
      name: 'rules',
      topic: 'Community expectations and program rules.',
      setting: 'rules_channel_id',
    });
    const start = await ensureChannel(env, rest, payload.guildId, channels, {
      name: 'start-here',
      topic: 'Join WTA and get your personal dashboard enrollment link.',
      setting: 'start_here_channel_id',
    });

    await upsertBotMessage(env, rest, rules.channel.id, 'rules_message_id', serverRulesMessage());
    await upsertBotMessage(env, rest, start.channel.id, 'start_here_message_id', enrollmentButtonMessage());

    const announceId = await getSetting(env, 'announce_channel_id');
    const welcomeChannels: Array<{ channel_id: string; description: string; emoji_name: string }> = [
      { channel_id: start.channel.id, description: 'Start here: join WTA 2026', emoji_name: '👋' },
      { channel_id: rules.channel.id, description: 'Read the community rules', emoji_name: '📖' },
    ];
    if (announceId && channels.some((channel) => channel.id === announceId)) {
      welcomeChannels.push({ channel_id: announceId, description: 'Program news and important dates', emoji_name: '📣' });
    }

    await rest.request('PATCH', `/guilds/${payload.guildId}`, { rules_channel_id: rules.channel.id });
    await rest.request('PATCH', `/guilds/${payload.guildId}/welcome-screen`, {
      enabled: true,
      description: 'Welcome to Western Tech Alumni. Start here to join WTA 2026 and get ready for recruiting.',
      welcome_channels: welcomeChannels,
    });

    let onboardingNote = '• Configured Discord’s Welcome Screen with Start Here first.';
    try {
      const onboarding = await rest.request<GuildOnboarding>('GET', `/guilds/${payload.guildId}/onboarding`);
      if (onboarding.enabled) {
        const defaults = [...new Set([
          start.channel.id,
          rules.channel.id,
          ...(announceId ? [announceId] : []),
          ...onboarding.default_channel_ids,
        ])];
        await rest.request('PATCH', `/guilds/${payload.guildId}/onboarding`, {
          enabled: true,
          mode: onboarding.mode,
          prompts: onboarding.prompts,
          default_channel_ids: defaults,
        });
        onboardingNote = '• Added Start Here and Rules to the server’s existing Onboarding defaults.';
      }
    } catch {
      // Welcome Screen remains the primary path when Community Onboarding is
      // unavailable. Do not fail otherwise-complete setup for this enhancement.
    }

    await report(
      '✅ **New-member welcome path is live.**\n' +
        `• ${rules.created ? 'Created' : 'Reused'} <#${rules.channel.id}> and published the community rules.\n` +
        `• ${start.created ? 'Created' : 'Reused'} <#${start.channel.id}> and published the **Join WTA** button.\n` +
        `${onboardingNote}\n\n` +
        '**One manual step remains:** copy the five rules into **Server Settings → Safety Setup → Rules Screening**. Discord no longer exposes that editor to bots.',
    );
  } catch (err) {
    await report(
      `⚠️ Welcome setup failed: \`${String(err).slice(0, 350)}\`\n` +
        'The bot needs **Manage Server**, **Manage Channels**, **Manage Roles**, **View Channels**, and **Send Messages**. The server must also have Community enabled for the Welcome Screen.',
    );
  }
}
