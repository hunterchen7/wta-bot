import type { Context } from 'hono';
import type { Env } from '../env';
import { verifyDiscordRequest } from './verify';

// https://discord.com/developers/docs/interactions/receiving-and-responding
const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, MODAL_SUBMIT: 5 } as const;
const EPHEMERAL = 64;

export async function handleInteraction(c: Context<{ Bindings: Env }>) {
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

  const interaction = JSON.parse(body);

  switch (interaction.type) {
    case InteractionType.PING:
      return c.json({ type: 1 });

    case InteractionType.APPLICATION_COMMAND: {
      const name: string = interaction.data?.name ?? 'unknown';
      // M1+: dispatch to real handlers (join intake, status, report, cancel, optout, admin).
      return c.json({
        type: 4,
        data: {
          content: `🚧 \`/${name}\` is registered but not built yet — this is the M0 skeleton.`,
          flags: EPHEMERAL,
        },
      });
    }

    case InteractionType.MESSAGE_COMPONENT:
    case InteractionType.MODAL_SUBMIT:
      return c.json({
        type: 4,
        data: { content: '🚧 Not implemented yet.', flags: EPHEMERAL },
      });

    default:
      return c.json({ error: 'unsupported interaction type' }, 400);
  }
}
