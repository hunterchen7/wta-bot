import { getSetting } from '../config';
import { DiscordRest } from '../discord/rest';
import { sendEmail } from '../email';
import type { Env } from '../env';
import type { OutboxKind } from './outbox';
import { enqueue } from './outbox';

// Executes one outbox row. Throwing marks the row for retry/backoff.

export async function executeOutbox(env: Env, kind: OutboxKind, payload: any): Promise<void> {
  const token = env.DISCORD_TOKEN;
  const rest = token ? new DiscordRest(token) : null;
  const needRest = () => {
    if (!rest) throw new Error('DISCORD_TOKEN not configured');
    return rest;
  };

  switch (kind) {
    case 'dm': {
      try {
        await needRest().dm(payload.userId, payload.message);
      } catch (err) {
        // DM-failure fallback (DESIGN §7): email if we can, plus organizer note.
        await dmFallback(env, payload, err);
      }
      return;
    }

    case 'channel_msg':
      await needRest().send(payload.channelId, payload.message);
      return;

    case 'thread_create': {
      const r = needRest();
      const thread = await r.createSessionThread(payload.channelId, payload.name, payload.starter);
      if (payload.sessionId) {
        await env.DB.prepare('UPDATE sessions SET thread_id = ?1 WHERE id = ?2')
          .bind(thread.id, payload.sessionId)
          .run();
      }
      return;
    }

    case 'role_add':
      await needRest().addRole(payload.guildId, payload.userId, payload.roleId);
      return;

    case 'nickname':
      await needRest().setNickname(payload.guildId, payload.userId, payload.nick);
      return;

    case 'discord_identity_sync': {
      const member = await needRest().getGuildMember(payload.guildId, payload.userId);
      await env.DB.prepare(
        "UPDATE participants SET discord_username = ?2, discord_nickname = ?3, updated_at = datetime('now') WHERE discord_id = ?1",
      ).bind(
        payload.userId,
        member.user.username,
        member.nick ?? member.user.global_name ?? member.user.username,
      ).run();
      return;
    }

    case 'email':
      await sendEmail(env, payload.to, payload.subject, payload.text);
      return;

    case 'guild_setup': {
      const { bootstrapGuild } = await import('./bootstrap');
      await bootstrapGuild(env, payload);
      return;
    }

    case 'guild_publish': {
      const { publishGuild } = await import('./bootstrap');
      await publishGuild(env, payload);
      return;
    }

    case 'followup': {
      // Edit the original deferred interaction response.
      const appId = env.DISCORD_APP_ID;
      if (!appId) throw new Error('DISCORD_APP_ID not configured');
      const res = await fetch(
        `https://discord.com/api/v10/webhooks/${appId}/${payload.interactionToken}/messages/@original`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload.message),
        },
      );
      if (!res.ok) throw new Error(`followup -> ${res.status}: ${await res.text()}`);
      return;
    }

    default:
      throw new Error(`unknown outbox kind: ${kind}`);
  }
}

async function dmFallback(env: Env, payload: any, err: unknown): Promise<void> {
  const participant = await env.DB.prepare(
    'SELECT id, email_ok, preferred_email, name FROM participants WHERE discord_id = ?1',
  )
    .bind(payload.userId)
    .first<{ id: number; email_ok: number; preferred_email: string | null; name: string | null }>();

  await env.DB.prepare(
    "INSERT INTO notify_log (participant_id, channel, kind, ref, status) VALUES (?1, 'dm', ?2, ?3, 'failed')",
  )
    .bind(participant?.id ?? null, payload.fallbackKind ?? 'dm', String(err).slice(0, 200))
    .run();

  // Always-send exception per DESIGN §7: DM failure fallback is operational.
  if (participant?.preferred_email) {
    const text =
      typeof payload.message?.content === 'string'
        ? payload.message.content.replace(/<[@#][!&]?\d+>/g, '(mention)')
        : 'You have a WTA update — check the Discord server.';
    await enqueue(env, 'email', {
      to: participant.preferred_email,
      subject: 'WTA update (your Discord DMs are closed)',
      text: `${text}\n\nYou received this by email because the bot could not DM you. Enable DMs from server members to get these in Discord.`,
    });
  }

  const organizerChannel = await getSetting(env, 'organizer_channel_id');
  if (organizerChannel) {
    await enqueue(env, 'channel_msg', {
      channelId: organizerChannel,
      message: {
        content: `⚠️ Could not DM <@${payload.userId}>${participant?.preferred_email ? ' — fell back to email' : ' — **unreachable** (no email on file either)'}.`,
      },
    });
  }
}
