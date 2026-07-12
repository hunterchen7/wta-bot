// Minimal hand-rolled types for the slices of Discord's interaction payloads
// we actually touch. https://discord.com/developers/docs/interactions/receiving-and-responding

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
} as const;

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  LABEL: 18,
} as const;

export const EPHEMERAL = 64;

export type DiscordUser = { id: string; username: string; global_name?: string | null };

export type Interaction = {
  type: number;
  id: string;
  token: string;
  guild_id?: string; // absent in DMs
  data?: {
    name?: string; // command name
    options?: Array<{ name: string; type: number; value?: string | number | boolean; options?: unknown[] }>;
    custom_id?: string; // component / modal id
    component_type?: number;
    values?: string[]; // select menu choice(s)
    components?: SubmittedComponent[]; // modal submit tree
  };
  member?: { user: DiscordUser; permissions?: string; roles?: string[] };
  user?: DiscordUser; // present in DMs instead of member
};

// Modal-submit tree: Label wrappers carry a single `component`; legacy action
// rows carry a `components` array. We parse both.
export type SubmittedComponent = {
  type: number;
  custom_id?: string;
  value?: string;
  values?: string[];
  component?: SubmittedComponent;
  components?: SubmittedComponent[];
};

export function interactionUser(interaction: Interaction): DiscordUser | null {
  return interaction.member?.user ?? interaction.user ?? null;
}

/** Flattens a modal-submit component tree into {custom_id: value | values[]}. */
export function collectModalValues(
  components: SubmittedComponent[] | undefined,
): Map<string, string | string[]> {
  const out = new Map<string, string | string[]>();
  const walk = (c: SubmittedComponent) => {
    if (c.custom_id && (c.value !== undefined || c.values !== undefined)) {
      out.set(c.custom_id, c.values ?? c.value ?? '');
    }
    if (c.component) walk(c.component);
    for (const child of c.components ?? []) walk(child);
  };
  for (const c of components ?? []) walk(c);
  return out;
}

export const ADMINISTRATOR = 1n << 3n;
export const MANAGE_GUILD = 1n << 5n;

export function hasPermission(interaction: Interaction, bit: bigint): boolean {
  const perms = interaction.member?.permissions;
  if (!perms) return false;
  try {
    return (BigInt(perms) & bit) === bit;
  } catch {
    return false;
  }
}
