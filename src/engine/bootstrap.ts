import { getSettings, setSetting } from '../config';
import { buttonRow } from '../discord/components';
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
//   creates the "WTA {year}" category + five program channels PRIVATE-FIRST
//   (visible to organizers + the bot only, for testing), creates
//   Member/Participant/Organizer roles if unconfigured, saves ids, posts the
//   verify panel. Nothing pre-existing is touched.
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

type Roles = { memberRole: string; participantRole: string; organizerRole: string; botUser: string; everyone: string };

/** The live, member-facing permission profile for each channel. */
function publicOverwrites(kind: string, r: Roles): unknown[] {
  const botAllow = r.botUser ? [{ id: r.botUser, type: 1, allow: kind === 'interviews' ? BOT_INTERVIEWS : VIEW_HIST_SEND }] : [];
  switch (kind) {
    case 'start_here':
      return [{ id: r.everyone, type: 0, allow: VIEW_HIST, deny: SEND }, ...botAllow];
    case 'announce':
      return [
        { id: r.everyone, type: 0, deny: String(1024) },
        { id: r.memberRole, type: 0, allow: VIEW_HIST, deny: SEND },
        ...botAllow,
      ];
    case 'intros':
      return [
        { id: r.everyone, type: 0, deny: String(1024) },
        { id: r.memberRole, type: 0, allow: VIEW_HIST_SEND },
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
  { kind: 'start_here', name: 'start-here', settingKey: 'start_here_channel_id' },
  { kind: 'announce', name: 'announcements', settingKey: 'announce_channel_id' },
  { kind: 'intros', name: 'introductions', settingKey: 'intro_channel_id' },
  { kind: 'interviews', name: 'interviews', settingKey: 'threads_channel_id' },
  { kind: 'organizers', name: 'wta-organizers', settingKey: 'organizer_channel_id' },
];

async function loadRoles(env: Env, rest: DiscordRest, guildId: string, createMissing: boolean): Promise<Roles> {
  const cfg = await getSettings(env, ['member_role_id', 'participant_role_id', 'organizer_role_id']);
  const ensure = async (key: 'member_role_id' | 'participant_role_id' | 'organizer_role_id', name: string) => {
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
    memberRole: await ensure('member_role_id', 'Member'),
    participantRole: await ensure('participant_role_id', 'Participant'),
    organizerRole: await ensure('organizer_role_id', 'Organizer'),
    botUser: env.DISCORD_APP_ID ?? '',
    everyone: guildId,
  };
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

    const cfg = await getSettings(env, ['start_here_channel_id']);
    await rest.send(cfg.start_here_channel_id!, {
      content:
        '**Welcome to Western Tech Alumni!** 👋\nTo keep bots out, click below and tell us who you are — takes 20 seconds and unlocks the server.',
      components: [buttonRow([{ id: 'verify:start', label: "Verify — I'm a real person", style: 3, emoji: '✅' }])],
    });

    await report(
      `🏗️ **WTA ${year} bootstrapped — in private/testing mode.**\n` +
        `• Category **WTA ${year}**: ${created.join(' ')}\n` +
        `• Visible to **organizers + the bot only** right now. Test freely.\n` +
        `• Roles: <@&${roles.memberRole}> <@&${roles.participantRole}> <@&${roles.organizerRole}> (created only if missing)\n` +
        `When you're ready to go live: \`/admin setup publish\` flips every channel to its member-facing permissions. ` +
        `(Reminder: bot role above Member/Participant, Manage Nicknames on.)`,
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
      `📢 **Live!** ${flipped.join(' ')} now carry their member-facing permissions: everyone sees #start-here, Members read announcements + chat in introductions, Participants use interview threads, organizers keep their room.`,
    );
  } catch (err) {
    await report(`⚠️ Publish failed: \`${String(err).slice(0, 300)}\` — check the bot's Manage Channels permission and that bootstrap ran first.`);
  }
}
