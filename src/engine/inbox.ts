import { DiscordRest } from '../discord/rest';
import type { Env } from '../env';

// Consolidated DM inbox. A webhook-only bot never receives DM events, but DMs
// are exempt from the privileged Message Content intent, so we can READ them
// over REST. Each tick we poll a bounded, round-robin batch of the DM channels
// the bot has opened (captured in the executor) and store any message the
// student sent — so organizers finally see replies to the bot's DMs.

// Per-tick cap keeps subrequests/rate-limit pressure bounded; the round-robin
// cursor (dm_last_polled_at) cycles through everyone within a few ticks.
const MAX_CHANNELS_PER_TICK = 40;
const MESSAGES_PER_POLL = 50;

type PollRow = {
  id: number;
  discord_id: string;
  dm_channel_id: string;
  dm_last_seen_id: string | null;
};

export async function inboxScan(env: Env, now = new Date(), maxChannels = MAX_CHANNELS_PER_TICK): Promise<number> {
  if (!env.DISCORD_TOKEN) return 0;
  const rest = new DiscordRest(env.DISCORD_TOKEN);

  const { results } = await env.DB.prepare(
    `SELECT id, discord_id, dm_channel_id, dm_last_seen_id FROM participants
     WHERE dm_channel_id IS NOT NULL AND status != 'removed'
     ORDER BY dm_last_polled_at IS NOT NULL, dm_last_polled_at ASC, id
     LIMIT ?1`,
  ).bind(maxChannels).all<PollRow>();

  let stored = 0;
  for (const p of results) {
    try {
      const messages = await rest.getChannelMessages(p.dm_channel_id, {
        after: p.dm_last_seen_id ?? undefined,
        limit: MESSAGES_PER_POLL,
      });
      // Discord returns newest-first; process oldest-first so the cursor and
      // insert order are chronological.
      let newest = p.dm_last_seen_id;
      for (const m of [...messages].reverse()) {
        newest = m.id; // advance past every message (incl. the bot's) to avoid re-fetching
        if (m.author?.bot || m.author?.id !== p.discord_id) continue; // only the student's messages
        const content = (m.content ?? '').trim().slice(0, 4000);
        if (!content) continue; // skip attachment-only / empty
        await env.DB.prepare(
          `INSERT INTO inbox_messages (participant_id, discord_message_id, content, created_at)
           VALUES (?1, ?2, ?3, ?4) ON CONFLICT(discord_message_id) DO NOTHING`,
        ).bind(p.id, m.id, content, m.timestamp).run();
        stored++;
      }
      await env.DB.prepare(
        'UPDATE participants SET dm_last_seen_id = ?2, dm_last_polled_at = ?3 WHERE id = ?1',
      ).bind(p.id, newest, now.toISOString()).run();
    } catch (err) {
      // Mark polled so one broken channel (deleted, forbidden) doesn't stall the
      // rotation; it'll be retried once the cursor comes back around.
      await env.DB.prepare('UPDATE participants SET dm_last_polled_at = ?2 WHERE id = ?1')
        .bind(p.id, now.toISOString()).run().catch(() => {});
      console.error(`inboxScan channel ${p.dm_channel_id} failed:`, err);
    }
  }
  return stored;
}
