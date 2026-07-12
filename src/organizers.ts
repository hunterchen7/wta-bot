import type { Env } from './env';

export function isWhitelistedAdmin(env: Env, email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (env.DASHBOARD_ADMINS ?? '')
    .split(',')
    .some((entry) => entry.trim().toLowerCase() === normalized);
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
