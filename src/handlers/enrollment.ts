import type { Context } from 'hono';
import { buttonRow, ephemeral } from '../discord/components';
import type { Interaction } from '../discord/types';
import { interactionUser } from '../discord/types';
import type { Env } from '../env';
import { signToken } from '../forms/token';
import { getParticipant, upsertParticipant } from '../participants';
import { logEnrollmentEvent, type EnrollmentEventSource } from '../services/enrollment-events';
import { isOrganizer } from './shared';

type Ctx = Context<{ Bindings: Env }>;

/** Return the same private, Discord-bound enrollment flow for `/join` and
 * the persistent Join WTA button. */
export async function enrollmentLinkResponse(c: Ctx, interaction: Interaction, source: EnrollmentEventSource) {
  const user = interactionUser(interaction);
  if (!user) return c.json(ephemeral('Could not identify you — try again.'));

  const existing = await getParticipant(c.env, user.id);
  // Enrollment only issues a signed link, so persist organizer eligibility
  // here even when this is their first-ever interaction.
  if (!existing && await isOrganizer(c.env, interaction)) {
    await upsertParticipant(c.env, user.id, {
      discord_username: user.username,
      discord_nickname: interaction.member?.nick ?? user.global_name ?? user.username,
      pairing_excluded: 1,
    });
  }
  if (existing?.status === 'removed') {
    if ((existing as any).removed_reason === 'withdrew') {
      return c.json(
        ephemeral(
          '👋 **Welcome back?** You left the program earlier — rejoining restores everything as it was: your profile, your completed interviews, your history. If you\'re behind pace, the next opt-in will offer you a catch-up double.',
          [buttonRow([{ id: 'rejoin:confirm', label: 'Rejoin the program', style: 3 }])],
        ),
      );
    }
    return c.json(
      ephemeral('You were removed from this cohort. Talk to an organizer if you think that\'s a mistake.'),
    );
  }

  const secret = c.env.FORM_SIGNING_SECRET;
  if (!secret) return c.json(ephemeral('Enrollment is not configured yet.'));
  const username = [...new TextEncoder().encode(user.username)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const token = await signToken(
    secret,
    `enroll:${user.id}:${interaction.guild_id ?? '0'}:${username}`,
    new Date(Date.now() + 60 * 60_000),
  );
  const origin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin;
  if (!existing?.topics) {
    await logEnrollmentEvent(c.env, {
      discordId: user.id,
      discordUsername: user.username,
      guildId: interaction.guild_id ?? null,
      eventType: 'link_generated',
      source,
      externalId: interaction.id,
    });
  }
  return c.json(
    ephemeral(
      `${existing?.topics ? 'Edit your WTA profile' : 'Complete your WTA enrollment'} in the web app (link valid for 1 hour):\n${origin}/enroll/${token}\n\n` +
        `This link is tied to **@${user.username}** and only visible to you.`,
    ),
  );
}
