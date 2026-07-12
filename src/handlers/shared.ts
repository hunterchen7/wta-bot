import { getSetting } from '../config';
import type { Env } from '../env';
import { ADMINISTRATOR, hasPermission, type Interaction, MANAGE_GUILD } from '../discord/types';

/** Organizer = Manage Server/Admin permission, or the configured organizer role. */
export async function isOrganizer(env: Env, interaction: Interaction): Promise<boolean> {
  if (hasPermission(interaction, ADMINISTRATOR) || hasPermission(interaction, MANAGE_GUILD)) return true;
  const roleId = await getSetting(env, 'organizer_role_id');
  return !!roleId && (interaction.member?.roles ?? []).includes(roleId);
}
