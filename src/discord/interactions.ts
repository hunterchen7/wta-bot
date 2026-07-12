import type { Context } from 'hono';
import type { Env } from '../env';
import * as intake from '../intake';
import { getParticipant, upsertParticipant } from '../participants';
import { signToken } from '../forms/token';
import { ephemeral } from './components';
import { DiscordRest } from './rest';
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

  switch (interaction.type) {
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

    case 'roster': {
      if (!hasPermission(interaction, ADMINISTRATOR) && !hasPermission(interaction, MANAGE_GUILD)) {
        return c.json(ephemeral('Organizers only.'));
      }
      const stats = await c.env.DB.prepare(
        `SELECT count(*) AS total,
                sum(CASE WHEN topics IS NOT NULL THEN 1 ELSE 0 END) AS complete,
                sum(CASE WHEN status != 'active' THEN 1 ELSE 0 END) AS inactive
         FROM participants`,
      ).first<{ total: number; complete: number | null; inactive: number | null }>();
      const { results: recent } = await c.env.DB.prepare(
        'SELECT name, discord_id, created_at FROM participants ORDER BY id DESC LIMIT 5',
      ).all<{ name: string | null; discord_id: string; created_at: string }>();
      const total = stats?.total ?? 0;
      const complete = stats?.complete ?? 0;
      const lines = recent.map(
        (r) => `• ${r.name ?? 'unnamed'} (<@${r.discord_id}>) — ${r.created_at.slice(0, 16)} UTC`,
      );
      return c.json(
        ephemeral(
          `**Enrollment** — ${total} signed up, ${complete} complete profiles, ${total - complete} partial` +
            `${(stats?.inactive ?? 0) > 0 ? `, ${stats?.inactive} inactive` : ''}` +
            (lines.length ? `\n**Most recent:**\n${lines.join('\n')}` : '\nNo sign-ups yet.') +
            `\nFull data: \`/export\``,
        ),
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

/** Nice touch: server nickname follows the entered real name. Fire-and-forget —
 *  never blocks or fails intake (missing Manage Nicknames, hierarchy, or the
 *  guild-owner immunity just log). Skipped in DMs. */
function syncNickname(c: Ctx, interaction: Interaction, userId: string, name: string) {
  const token = c.env.DISCORD_TOKEN;
  const guildId = interaction.guild_id;
  if (!token || !guildId) return;
  const nick = name.trim().slice(0, 32); // Discord nickname cap
  if (!nick) return;
  const run = new DiscordRest(token)
    .setNickname(guildId, userId, nick)
    .catch((err) => console.error('nickname sync failed (non-fatal):', err));
  try {
    c.executionCtx.waitUntil(run);
  } catch {
    // no execution context (tests) — the promise still runs
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

async function handleModalSubmit(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction);
  if (!user) return c.json(ephemeral('Could not identify you — try again.'));
  const values = collectModalValues(interaction.data?.components);

  switch (interaction.data?.custom_id) {
    case intake.IDS.modal1: {
      const fields = intake.parseModal1(values);
      await upsertParticipant(c.env, user.id, fields);
      if (fields.name) syncNickname(c, interaction, user.id, fields.name);
      return c.json(intake.afterModal1());
    }
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
