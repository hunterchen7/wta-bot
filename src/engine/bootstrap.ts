import { getSettings, setSetting } from '../config';
import { buttonRow } from '../discord/components';
import { DiscordRest } from '../discord/rest';
import type { Env } from '../env';
import { enqueue } from './outbox';

// Annual server bootstrap (/admin setup bootstrap year:N):
//   1. Archive: lock last year's channels read-only, rename the old category.
//   2. Create "WTA {year}" category + the five program channels with
//      permission overwrites baked in.
//   3. Create Member/Participant/Organizer roles if none are configured.
//   4. Save all ids to settings and post the verify panel.
// Requires the bot role to have Manage Channels + Manage Roles.

const VIEW_HIST = String(1024 + 65536); // VIEW_CHANNEL + READ_MESSAGE_HISTORY
const SEND = String(2048);
const VIEW_HIST_SEND = String(1024 + 65536 + 2048);
const PARTICIPANT_INTERVIEWS = String(1024 + 65536 + 274877906944); // + SEND_IN_THREADS
const ORGANIZER_INTERVIEWS = String(1024 + 65536 + 274877906944 + 17179869184); // + MANAGE_THREADS
const BOT_INTERVIEWS = String(
  1024 + 65536 + 2048 + 34359738368 + 68719476736 + 274877906944 + 17179869184,
); // + create public/private threads
const LOCK_SENDS = String(2048 + 274877906944 + 34359738368 + 68719476736); // send + threads

export async function bootstrapGuild(
  env: Env,
  payload: { guildId: string; year: number; interactionToken: string },
): Promise<void> {
  const token = env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN not configured');
  const rest = new DiscordRest(token);
  const { guildId, year } = payload;
  const everyone = guildId; // @everyone role id == guild id
  const botUser = env.DISCORD_APP_ID ?? '';

  const report = (content: string) =>
    enqueue(env, 'followup', { interactionToken: payload.interactionToken, message: { content } });

  try {
    const cfg = await getSettings(env, [
      'announce_channel_id',
      'organizer_channel_id',
      'threads_channel_id',
      'start_here_channel_id',
      'intro_channel_id',
      'member_role_id',
      'participant_role_id',
      'organizer_role_id',
      'category_id',
    ]);

    // ---- 1. Archive last year -------------------------------------------
    const oldChannels = [
      cfg.announce_channel_id,
      cfg.organizer_channel_id,
      cfg.threads_channel_id,
      cfg.start_here_channel_id,
      cfg.intro_channel_id,
    ].filter(Boolean) as string[];
    let archived = 0;
    for (const channelId of oldChannels) {
      await rest
        .request('PUT', `/channels/${channelId}/permissions/${everyone}`, {
          type: 0,
          deny: LOCK_SENDS,
        })
        .then(() => archived++)
        .catch(() => {}); // channel may be deleted — fine
    }
    if (cfg.category_id) {
      await rest
        .request('PATCH', `/channels/${cfg.category_id}`, { name: `WTA archive` })
        .catch(() => {});
    }

    // ---- 2. Roles (create only when unconfigured) -------------------------
    const ensureRole = async (key: 'member_role_id' | 'participant_role_id' | 'organizer_role_id', name: string) => {
      if (cfg[key]) return cfg[key]!;
      const role = await rest.request<{ id: string }>('POST', `/guilds/${guildId}/roles`, {
        name,
        permissions: '0',
        mentionable: key === 'participant_role_id',
      });
      await setSetting(env, key, role.id);
      return role.id;
    };
    const memberRole = await ensureRole('member_role_id', 'Member');
    const participantRole = await ensureRole('participant_role_id', 'Participant');
    const organizerRole = await ensureRole('organizer_role_id', 'Organizer');

    // ---- 3. Category + channels ------------------------------------------
    const botAllow = (allow: string) => (botUser ? [{ id: botUser, type: 1, allow }] : []);
    const category = await rest.request<{ id: string }>('POST', `/guilds/${guildId}/channels`, {
      name: `WTA ${year}`,
      type: 4,
      permission_overwrites: [{ id: everyone, type: 0, deny: String(1024) }],
    });
    await setSetting(env, 'category_id', category.id);

    const mk = (name: string, overwrites: unknown[], type = 0) =>
      rest.request<{ id: string }>('POST', `/guilds/${guildId}/channels`, {
        name,
        type,
        parent_id: category.id,
        permission_overwrites: overwrites,
      });

    const startHere = await mk('start-here', [
      { id: everyone, type: 0, allow: VIEW_HIST, deny: SEND },
      ...botAllow(VIEW_HIST_SEND),
    ]);
    const announce = await mk('announcements', [
      { id: everyone, type: 0, deny: String(1024) },
      { id: memberRole, type: 0, allow: VIEW_HIST, deny: SEND },
      ...botAllow(VIEW_HIST_SEND),
    ]);
    const intros = await mk('introductions', [
      { id: everyone, type: 0, deny: String(1024) },
      { id: memberRole, type: 0, allow: VIEW_HIST_SEND },
      ...botAllow(VIEW_HIST_SEND),
    ]);
    const interviews = await mk('interviews', [
      { id: everyone, type: 0, deny: String(1024) },
      { id: participantRole, type: 0, allow: PARTICIPANT_INTERVIEWS, deny: SEND },
      { id: organizerRole, type: 0, allow: ORGANIZER_INTERVIEWS },
      ...botAllow(BOT_INTERVIEWS),
    ]);
    const organizers = await mk('wta-organizers', [
      { id: everyone, type: 0, deny: String(1024) },
      { id: organizerRole, type: 0, allow: VIEW_HIST_SEND },
      ...botAllow(VIEW_HIST_SEND),
    ]);

    await setSetting(env, 'start_here_channel_id', startHere.id);
    await setSetting(env, 'announce_channel_id', announce.id);
    await setSetting(env, 'intro_channel_id', intros.id);
    await setSetting(env, 'threads_channel_id', interviews.id);
    await setSetting(env, 'organizer_channel_id', organizers.id);

    // ---- 4. Verify panel in the new start-here ----------------------------
    await enqueue(env, 'channel_msg', {
      channelId: startHere.id,
      message: {
        content:
          '**Welcome to Western Tech Alumni!** 👋\nTo keep bots out, click below and tell us who you are — takes 20 seconds and unlocks the server.',
        components: [buttonRow([{ id: 'verify:start', label: "Verify — I'm a real person", style: 3, emoji: '✅' }])],
      },
    });

    await report(
      `🏗️ **WTA ${year} bootstrapped!**\n` +
        `• Category **WTA ${year}**: <#${startHere.id}> <#${announce.id}> <#${intros.id}> <#${interviews.id}> <#${organizers.id}>\n` +
        `• Roles: <@&${memberRole}> <@&${participantRole}> <@&${organizerRole}> (created only if missing)\n` +
        (archived ? `• Archived: ${archived} previous channel(s) locked read-only\n` : '') +
        `Next: give organizers the role, \`/admin backfill\` if this server has existing members, load problems, then \`/admin setup cohort\`. ` +
        `(Reminder: drag the bot's role above Member/Participant.)`,
    );
  } catch (err) {
    // Permission problems shouldn't retry forever — explain and stop.
    await report(
      `⚠️ Bootstrap failed: \`${String(err).slice(0, 300)}\`\n` +
        'Usual cause: the bot role is missing **Manage Channels** or **Manage Roles**, or sits below the roles it must create/assign. Fix in Server Settings → Roles, then rerun.',
    );
  }
}
