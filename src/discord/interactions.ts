import type { Context } from 'hono';
import type { Env } from '../env';
import * as intake from '../intake';
import { getParticipant, upsertParticipant } from '../participants';
import { signToken } from '../forms/token';
import { ephemeral } from './components';
import {
  ADMINISTRATOR,
  collectModalValues,
  hasPermission,
  type Interaction,
  interactionUser,
  InteractionType,
  MANAGE_GUILD,
  ResponseType,
} from './types';
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

  switch (interaction.type) {
    case InteractionType.PING:
      return c.json({ type: ResponseType.PONG });
    case InteractionType.APPLICATION_COMMAND:
      return handleCommand(c, interaction);
    case InteractionType.MESSAGE_COMPONENT:
      return handleComponent(c, interaction);
    case InteractionType.MODAL_SUBMIT:
      return handleModalSubmit(c, interaction);
    default:
      return c.json({ error: 'unsupported interaction type' }, 400);
  }
}

async function handleCommand(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction);
  if (!user) return c.json(ephemeral('Could not identify you — try again.'));

  switch (interaction.data?.name) {
    case 'join': {
      const existing = await getParticipant(c.env, user.id);
      return c.json(intake.modal1(existing));
    }

    case 'status': {
      const row = await getParticipant(c.env, user.id);
      if (!row) {
        return c.json(ephemeral("You're not enrolled yet — run `/join` to sign up."));
      }
      const complete = row.year !== null && row.topics !== null;
      return c.json(
        ephemeral(
          complete
            ? `You're enrolled ✅ (${row.name ?? user.username}). Weekly sessions, owed forms, and progress will show here once the cohort starts.`
            : "Your sign-up is incomplete — run `/join` to finish the remaining steps.",
        ),
      );
    }

    case 'export': {
      if (!hasPermission(interaction, ADMINISTRATOR) && !hasPermission(interaction, MANAGE_GUILD)) {
        return c.json(ephemeral('Organizers only.'));
      }
      const secret = c.env.FORM_SIGNING_SECRET;
      if (!secret) return c.json(ephemeral('Form rail not configured (FORM_SIGNING_SECRET).'));
      const token = await signToken(secret, 'export:participants', new Date(Date.now() + 10 * 60_000));
      const origin = new URL(c.req.url).origin;
      return c.json(
        ephemeral(`Roster CSV (link valid 10 minutes):\n${origin}/export/${token}`),
      );
    }

    case 'optout':
    case 'cancel':
    case 'report':
      return c.json(ephemeral(`🚧 \`/${interaction.data.name}\` arrives with the weekly cycle (M2/M4).`));

    default:
      return c.json(ephemeral(`Unknown command.`));
  }
}

async function handleComponent(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction);
  if (!user) return c.json(ephemeral('Could not identify you — try again.'));
  const existing = await getParticipant(c.env, user.id);

  switch (interaction.data?.custom_id) {
    case intake.IDS.continue2:
      return c.json(intake.modal2(existing));
    case intake.IDS.continue3:
      return c.json(intake.modal3(existing));
    default:
      return c.json(ephemeral('🚧 Not implemented yet.'));
  }
}

async function handleModalSubmit(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction);
  if (!user) return c.json(ephemeral('Could not identify you — try again.'));
  const values = collectModalValues(interaction.data?.components);

  switch (interaction.data?.custom_id) {
    case intake.IDS.modal1:
      await upsertParticipant(c.env, user.id, intake.parseModal1(values));
      return c.json(intake.afterModal1());
    case intake.IDS.modal2:
      await upsertParticipant(c.env, user.id, intake.parseModal2(values));
      return c.json(intake.afterModal2());
    case intake.IDS.modal3:
      await upsertParticipant(c.env, user.id, intake.parseModal3(values));
      return c.json(intake.afterModal3());
    default:
      return c.json(ephemeral('🚧 Not implemented yet.'));
  }
}
