import { getSetting, getSettings, setSetting } from '../config';
import { DiscordRest } from '../discord/rest';
import type { Env } from '../env';

/** Edits the deferred "thinking…" response immediately (no cron round-trip). */
async function editOriginal(env: Env, interactionToken: string, content: string): Promise<void> {
  const appId = env.DISCORD_APP_ID;
  if (!appId) return;
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch((err) => console.error('followup edit failed:', err));
}

// Annual server bootstrap (/admin setup bootstrap year:N):
//   creates the "WTA {year}" category + program channels PRIVATE-FIRST
//   (visible to organizers + the bot only for testing), then creates the
//   Participant/Organizer roles if needed. Discord's native verification owns
//   server entry; the bot only gates program participation.
// /admin setup publish later flips the channels to their member-facing
// permissions. Requires Manage Channels + Manage Roles on the bot role.

const VIEW_HIST = String(1024 + 65536); // VIEW_CHANNEL + READ_MESSAGE_HISTORY
const SEND = String(2048);
const VIEW_HIST_SEND = String(1024 + 65536 + 2048);
const PARTICIPANT_INTERVIEWS = String(1024 + 65536 + 274877906944); // + SEND_IN_THREADS
const ORGANIZER_INTERVIEWS = String(1024 + 65536 + 2048 + 274877906944 + 17179869184); // + MANAGE_THREADS
const BOT_INTERVIEWS = String(
  1024 + 65536 + 2048 + 34359738368 + 68719476736 + 274877906944 + 17179869184,
); // + create public/private threads

type Roles = { participantRole: string; organizerRole: string; botUser: string; everyone: string };

/** The live, member-facing permission profile for each channel. */
function publicOverwrites(kind: string, r: Roles): unknown[] {
  const botAllow = r.botUser ? [{ id: r.botUser, type: 1, allow: kind === 'interviews' ? BOT_INTERVIEWS : VIEW_HIST_SEND }] : [];
  switch (kind) {
    case 'announce':
      return [
        { id: r.everyone, type: 0, allow: VIEW_HIST, deny: SEND },
        ...botAllow,
      ];
    case 'pairing':
      return [
        { id: r.everyone, type: 0, deny: String(1024) },
        { id: r.participantRole, type: 0, allow: VIEW_HIST, deny: SEND },
        { id: r.organizerRole, type: 0, allow: VIEW_HIST_SEND },
        ...botAllow,
      ];
    case 'interviews':
      return [
        { id: r.everyone, type: 0, deny: String(1024) },
        { id: r.participantRole, type: 0, allow: PARTICIPANT_INTERVIEWS, deny: SEND },
        { id: r.organizerRole, type: 0, allow: ORGANIZER_INTERVIEWS },
        ...botAllow,
      ];
    default: // organizers channel — same in both profiles
      return [
        { id: r.everyone, type: 0, deny: String(1024) },
        { id: r.organizerRole, type: 0, allow: VIEW_HIST_SEND },
        ...botAllow,
      ];
  }
}

/** Testing profile: organizers + bot only, regular members see nothing. */
function privateOverwrites(kind: string, r: Roles): unknown[] {
  const botAllow = r.botUser ? [{ id: r.botUser, type: 1, allow: kind === 'interviews' ? BOT_INTERVIEWS : VIEW_HIST_SEND }] : [];
  return [
    { id: r.everyone, type: 0, deny: String(1024) },
    { id: r.organizerRole, type: 0, allow: kind === 'interviews' ? ORGANIZER_INTERVIEWS : VIEW_HIST_SEND },
    ...botAllow,
  ];
}

const CHANNEL_KINDS: Array<{ kind: string; name: string; settingKey: any }> = [
  { kind: 'announce', name: 'announcements', settingKey: 'announce_channel_id' },
  { kind: 'pairing', name: 'pairing', settingKey: 'pairing_channel_id' },
  { kind: 'interviews', name: 'interviews', settingKey: 'threads_channel_id' },
  { kind: 'organizers', name: 'wta-organizers', settingKey: 'organizer_channel_id' },
];

async function loadRoles(env: Env, rest: DiscordRest, guildId: string, createMissing: boolean): Promise<Roles> {
  const cfg = await getSettings(env, ['participant_role_id', 'organizer_role_id']);
  const ensure = async (key: 'participant_role_id' | 'organizer_role_id', name: string) => {
    if (cfg[key]) return cfg[key]!;
    if (!createMissing) throw new Error(`missing role setting ${key} — run bootstrap first`);
    const role = await rest.request<{ id: string }>('POST', `/guilds/${guildId}/roles`, {
      name,
      permissions: '0',
      mentionable: key === 'participant_role_id',
    });
    await setSetting(env, key, role.id);
    return role.id;
  };
  return {
    participantRole: await ensure('participant_role_id', 'Participant'),
    organizerRole: await ensure('organizer_role_id', 'Organizer'),
    botUser: env.DISCORD_APP_ID ?? '',
    everyone: guildId,
  };
}

/** Upgrade an already-published guild without requiring another bootstrap. */
export async function ensurePairingChannel(env: Env, requestedGuildId?: string): Promise<string | null> {
  const existing = await getSetting(env, 'pairing_channel_id');
  if (existing) return existing;
  const guildId = requestedGuildId ?? env.ALLOWED_GUILD_IDS?.split(',')[0]?.trim();
  if (!env.DISCORD_TOKEN || !guildId) return null;

  const rest = new DiscordRest(env.DISCORD_TOKEN);
  const roles = await loadRoles(env, rest, guildId, false);
  const categoryId = await getSetting(env, 'category_id');
  const pairing = await rest.request<{ id: string }>('POST', `/guilds/${guildId}/channels`, {
    name: 'pairing',
    type: 0,
    ...(categoryId ? { parent_id: categoryId } : {}),
    permission_overwrites: publicOverwrites('pairing', roles),
  });
  await setSetting(env, 'pairing_channel_id', pairing.id);
  return pairing.id;
}

export async function bootstrapGuild(
  env: Env,
  payload: { guildId: string; year: number; interactionToken: string },
): Promise<void> {
  const token = env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN not configured');
  const rest = new DiscordRest(token);
  const { guildId, year } = payload;
  const report = (content: string) => editOriginal(env, payload.interactionToken, content);

  try {
    const roles = await loadRoles(env, rest, guildId, true);

    const category = await rest.request<{ id: string }>('POST', `/guilds/${guildId}/channels`, {
      name: `WTA ${year}`,
      type: 4,
      permission_overwrites: [{ id: roles.everyone, type: 0, deny: String(1024) }],
    });
    await setSetting(env, 'category_id', category.id);

    const created: string[] = [];
    for (const ch of CHANNEL_KINDS) {
      const channel = await rest.request<{ id: string }>('POST', `/guilds/${guildId}/channels`, {
        name: ch.name,
        type: 0,
        parent_id: category.id,
        permission_overwrites: privateOverwrites(ch.kind, roles),
      });
      await setSetting(env, ch.settingKey, channel.id);
      created.push(`<#${channel.id}>`);
    }

    await report(
      `🏗️ **WTA ${year} bootstrapped — in private/testing mode.**\n` +
        `• Category **WTA ${year}**: ${created.join(' ')}\n` +
        `• Visible to **organizers + the bot only** right now. Test freely.\n` +
        `• Roles: <@&${roles.participantRole}> <@&${roles.organizerRole}> (created only if missing)\n` +
        `When you're ready to go live: \`/admin setup publish\` flips every channel to its member-facing permissions. ` +
        `(Reminder: bot role above Participant, Manage Nicknames on. Discord native verification handles server access.)`,
    );
  } catch (err) {
    await report(
      `⚠️ Bootstrap failed: \`${String(err).slice(0, 300)}\`\n` +
        'Usual cause: the bot role is missing **Manage Channels** or **Manage Roles**, or sits below the roles it must create/assign. Fix in Server Settings → Roles, then rerun.',
    );
  }
}

/** /admin setup publish — flip the bootstrapped channels to live permissions. */
export async function publishGuild(env: Env, payload: { guildId: string; interactionToken: string }): Promise<void> {
  const token = env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN not configured');
  const rest = new DiscordRest(token);
  const report = (content: string) => editOriginal(env, payload.interactionToken, content);

  try {
    const roles = await loadRoles(env, rest, payload.guildId, false);
    await ensurePairingChannel(env, payload.guildId);
    const cfg = await getSettings(env, CHANNEL_KINDS.map((c) => c.settingKey));
    const flipped: string[] = [];
    for (const ch of CHANNEL_KINDS) {
      const id = (cfg as any)[ch.settingKey];
      if (!id) continue;
      await rest.request('PATCH', `/channels/${id}`, {
        permission_overwrites: publicOverwrites(ch.kind, roles),
      });
      flipped.push(`<#${id}>`);
    }
    await report(
      `📢 **Live!** ${flipped.join(' ')} now carry their live permissions: everyone can read announcements, Participants get the private pairing feed and use interview threads, and organizers keep their room. Discord native verification handles server entry.`,
    );
  } catch (err) {
    await report(`⚠️ Publish failed: \`${String(err).slice(0, 300)}\` — check the bot's Manage Channels permission and that bootstrap ran first.`);
  }
}
