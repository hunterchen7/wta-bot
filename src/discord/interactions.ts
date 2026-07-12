import type { Context } from 'hono';
import type { Env } from '../env';
import { handleCommand } from '../handlers/commands';
import { handleComponent, handleModal } from '../handlers/components';
import { ephemeral } from './components';
import { DiscordRest } from './rest';
import { type Interaction, InteractionType, ResponseType, interactionUser } from './types';
import { verifyDiscordRequest } from './verify';

type Ctx = Context<{ Bindings: Env }>;

export async function handleInteraction(c: Ctx) {
  const publicKey = c.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) return c.text('interactions endpoint not configured', 503);

  const signature = c.req.header('x-signature-ed25519');
  const timestamp = c.req.header('x-signature-timestamp');
  const body = await c.req.text();
  if (
    !signature ||
    !timestamp ||
    !(await verifyDiscordRequest(publicKey, signature, timestamp, body))
  ) {
    return c.text('invalid request signature', 401);
  }

  const interaction = JSON.parse(body) as Interaction;

  // PING must always pong — it's how Discord verifies the endpoint.
  if (interaction.type === InteractionType.PING) {
    return c.json({ type: ResponseType.PONG });
  }

  // Public app, private program: interactions from foreign guilds get a
  // polite refusal, touch nothing, and the bot leaves that guild.
  if (!guildAllowed(c.env, interaction)) {
    leaveForeignGuild(c, interaction.guild_id!);
    return c.json(
      ephemeral(
        'This bot runs a private program for **Western Tech Alumni** and does not work in other servers. It will remove itself shortly. 👋',
      ),
    );
  }

  const user = interactionUser(interaction);
  if (user) {
    await c.env.DB.prepare(
      "UPDATE participants SET discord_username = ?2, updated_at = datetime('now') WHERE discord_id = ?1",
    ).bind(user.id, user.global_name ?? user.username).run();
  }

  switch (interaction.type) {
    case InteractionType.APPLICATION_COMMAND:
      return handleCommand(c, interaction);
    case InteractionType.MESSAGE_COMPONENT:
      return handleComponent(c, interaction);
    case InteractionType.MODAL_SUBMIT:
      return handleModal(c, interaction);
    default:
      return c.json({ error: 'unsupported interaction type' }, 400);
  }
}

function guildAllowed(env: Env, interaction: Interaction): boolean {
  const raw = env.ALLOWED_GUILD_IDS?.trim();
  if (!raw) return true; // unconfigured (pre-setup) — allow
  if (!interaction.guild_id) return true; // DMs are user-scoped, always fine
  return raw
    .split(',')
    .map((s) => s.trim())
    .includes(interaction.guild_id);
}

function leaveForeignGuild(c: Ctx, guildId: string) {
  const token = c.env.DISCORD_TOKEN;
  if (!token) return;
  const leave = new DiscordRest(token).leaveGuild(guildId).catch(() => {});
  try {
    c.executionCtx.waitUntil(leave);
  } catch {
    // no execution context (tests) — the promise still runs
  }
}
