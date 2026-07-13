import type { Env } from './env';
import { getSetting } from './config';
import { DiscordRest } from './discord/rest';
import { ADMINISTRATOR, MANAGE_GUILD } from './discord/types';

export function isWhitelistedAdmin(env: Env, email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (env.DASHBOARD_ADMINS ?? '')
    .split(',')
    .some((entry) => entry.trim().toLowerCase() === normalized);
}

/** Re-check organizer access against current configuration instead of trusting
 * the privilege bit cached in a browser session or API token. */
export async function isCurrentOrganizer(env: Env, participantId: number): Promise<boolean> {
  const participant = await env.DB.prepare(
    "SELECT discord_id, preferred_email, status FROM participants WHERE id = ?1",
  ).bind(participantId).first<{ discord_id: string; preferred_email: string | null; status: string }>();
  if (!participant || participant.status === 'removed') return false;
  if (isWhitelistedAdmin(env, participant.preferred_email)) return true;

  const roleId = await getSetting(env, 'organizer_role_id');
  const guildId = env.ALLOWED_GUILD_IDS?.split(',')[0]?.trim();
  if (!guildId || !env.DISCORD_TOKEN) return false;
  try {
    const discord = new DiscordRest(env.DISCORD_TOKEN);
    const member = await discord.getGuildMember(guildId, participant.discord_id);
    if (roleId && member.roles.includes(roleId)) return true;

    const [guild, roles] = await Promise.all([
      discord.getGuild(guildId),
      discord.getGuildRoles(guildId),
    ]);
    if (guild.owner_id === participant.discord_id) return true;

    const memberRoleIds = new Set([guildId, ...member.roles]);
    let permissions = 0n;
    for (const role of roles) {
      if (!memberRoleIds.has(role.id)) continue;
      try { permissions |= BigInt(role.permissions); } catch { /* Ignore malformed Discord data. */ }
    }
    return (permissions & ADMINISTRATOR) === ADMINISTRATOR
      || (permissions & MANAGE_GUILD) === MANAGE_GUILD;
  } catch (error) {
    console.warn('organizer revalidation failed', {
      participantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Permanently keep a known organizer out of participant matching.
 * Enrollment remains available so organizers can exercise the real dashboard/forms. */
export async function excludeOrganizerFromPairing(env: Env, participantId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE participants SET pairing_excluded = 1, updated_at = datetime('now') WHERE id = ?1",
    ).bind(participantId),
    env.DB.prepare('DELETE FROM optins WHERE participant_id = ?1').bind(participantId),
    env.DB.prepare(
      "UPDATE repair_queue SET state = 'expired' WHERE participant_id = ?1 AND state = 'open'",
    ).bind(participantId),
  ]);
}

export async function excludeOrganizerByDiscordId(env: Env, discordId: string): Promise<void> {
  const participant = await env.DB.prepare('SELECT id FROM participants WHERE discord_id = ?1')
    .bind(discordId)
    .first<{ id: number }>();
  if (participant) await excludeOrganizerFromPairing(env, participant.id);
}
