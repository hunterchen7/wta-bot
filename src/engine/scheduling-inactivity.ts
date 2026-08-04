import { getSettings } from '../config';
import { DiscordRest } from '../discord/rest';
import type { Env } from '../env';
import { enqueue } from './outbox';
import { enqueueRepair } from './repair';
import { closeSessionThread } from './session-thread';

const NUDGE_AFTER_HOURS = 48;
const REPAIR_AFTER_HOURS = 72;
const SCAN_LIMIT = 50;

type PendingSession = {
  id: number;
  week_id: number;
  week_idx: number;
  interviewer_id: number;
  interviewee_id: number;
  interviewer_discord_id: string;
  interviewee_discord_id: string;
  interviewer_name: string | null;
  interviewee_name: string | null;
  thread_id: string;
  created_at: string;
  activity_nudged_at: string | null;
  activity_checked_at: string | null;
};

export type SchedulingInactivityResult = {
  nudged: number;
  repaired: number;
  skipped: number;
  errors: number;
};

/**
 * Checks each unscheduled thread at most twice:
 * - T+48h: ping the silent participant, or both when nobody has spoken.
 * - T+72h: if exactly one participant has spoken, remove the silent person
 *   from new pairings for the round and re-pair affected partners.
 *
 * Existing sessions that predate this feature still receive a full 24-hour
 * warning: the 72-hour action requires activity_nudged_at to be at least 24
 * hours old.
 */
export async function schedulingInactivityScan(
  env: Env,
  now = new Date(),
): Promise<SchedulingInactivityResult> {
  const result: SchedulingInactivityResult = { nudged: 0, repaired: 0, skipped: 0, errors: 0 };
  if (!env.DISCORD_TOKEN) return result;

  const nudgeBefore = new Date(now.getTime() - NUDGE_AFTER_HOURS * 3600_000).toISOString();
  const repairBefore = new Date(now.getTime() - REPAIR_AFTER_HOURS * 3600_000).toISOString();
  const warningBefore = new Date(now.getTime() - (REPAIR_AFTER_HOURS - NUDGE_AFTER_HOURS) * 3600_000).toISOString();
  const { results: sessions } = await env.DB.prepare(
    `SELECT s.id, s.week_id, w.idx AS week_idx,
            s.interviewer_id, s.interviewee_id, s.thread_id, s.created_at,
            s.activity_nudged_at, s.activity_checked_at,
            pi.discord_id AS interviewer_discord_id, pi.name AS interviewer_name,
            pe.discord_id AS interviewee_discord_id, pe.name AS interviewee_name
     FROM sessions s
     JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id
     JOIN participants pe ON pe.id = s.interviewee_id
     WHERE s.state = 'pending_schedule' AND s.thread_id IS NOT NULL
       AND (
         (s.activity_nudged_at IS NULL AND datetime(s.created_at) <= datetime(?1))
         OR
         (s.activity_checked_at IS NULL AND s.activity_nudged_at IS NOT NULL
          AND datetime(s.created_at) <= datetime(?2)
          AND datetime(s.activity_nudged_at) <= datetime(?3))
       )
     ORDER BY CASE WHEN s.activity_nudged_at IS NULL THEN 1 ELSE 0 END, s.created_at, s.id
     LIMIT ?4`,
  ).bind(nudgeBefore, repairBefore, warningBefore, SCAN_LIMIT).all<PendingSession>();

  const discord = new DiscordRest(env.DISCORD_TOKEN);
  for (const session of sessions) {
    let actionClaimed = false;
    try {
      const messages = await discord.getChannelMessages(session.thread_id, { limit: 100 });
      const active = new Set(
        messages
          .map((message) => message.author.id)
          .filter((id) => id === session.interviewer_discord_id || id === session.interviewee_discord_id),
      );

      if (session.activity_nudged_at === null) {
        await sendInactivityNudge(env, session, active, now);
        if (active.size < 2) result.nudged++;
        else result.skipped++;
        continue;
      }

      const claimed = await env.DB.prepare(
        `UPDATE sessions SET activity_checked_at = ?2
         WHERE id = ?1 AND state = 'pending_schedule' AND activity_checked_at IS NULL`,
      ).bind(session.id, now.toISOString()).run();
      if (Number(claimed.meta.changes ?? 0) === 0) continue;
      actionClaimed = true;

      if (active.size !== 1) {
        // Both silent: no one gets priority. Both active: let them finish
        // scheduling without automatic intervention.
        result.skipped++;
        continue;
      }

      const activeDiscordId = [...active][0]!;
      const inactiveId = activeDiscordId === session.interviewer_discord_id
        ? session.interviewee_id
        : session.interviewer_id;
      await removeInactiveParticipantFromRound(env, session, inactiveId, now);
      result.repaired++;
    } catch (error) {
      if (actionClaimed) {
        await env.DB.prepare(
          `UPDATE sessions SET activity_checked_at = NULL
           WHERE id = ?1 AND state = 'pending_schedule'`,
        ).bind(session.id).run().catch(() => {});
      }
      result.errors++;
      console.error(`scheduling inactivity scan failed for session ${session.id}:`, error);
    }
  }
  return result;
}

async function sendInactivityNudge(
  env: Env,
  session: PendingSession,
  active: Set<string>,
  now: Date,
): Promise<void> {
  const claimed = await env.DB.prepare(
    `UPDATE sessions SET activity_nudged_at = ?2
     WHERE id = ?1 AND state = 'pending_schedule' AND activity_nudged_at IS NULL`,
  ).bind(session.id, now.toISOString()).run();
  if (Number(claimed.meta.changes ?? 0) === 0) return;

  const participants = [session.interviewer_discord_id, session.interviewee_discord_id];
  const silent = participants.filter((discordId) => !active.has(discordId));
  if (silent.length === 0) return;

  const intro = silent.length === 2
    ? 'no one has started scheduling yet'
    : 'your partner is waiting for you to help schedule';
  const consequence = silent.length === 2
    ? `If only one of you participates, the inactive person will be removed from Round ${session.week_idx} and the active person will be re-paired.`
    : `If you don't schedule a time, you will be removed from Round ${session.week_idx}.`;
  try {
    await enqueue(env, 'channel_msg', {
      channelId: session.thread_id,
      message: {
        content:
          `⏰ ${silent.map((discordId) => `<@${discordId}>`).join(' ')} — ${intro}. ` +
          `Please reply here and confirm a time within the next 24 hours. **${consequence}**`,
        allowed_mentions: { parse: [], users: silent },
      },
    });
  } catch (error) {
    await env.DB.prepare(
      `UPDATE sessions SET activity_nudged_at = NULL
       WHERE id = ?1 AND state = 'pending_schedule'`,
    ).bind(session.id).run().catch(() => {});
    throw error;
  }
}

async function removeInactiveParticipantFromRound(
  env: Env,
  trigger: PendingSession,
  inactiveId: number,
  now: Date,
): Promise<void> {
  const inactive = inactiveId === trigger.interviewer_id
    ? { discordId: trigger.interviewer_discord_id, name: trigger.interviewer_name }
    : { discordId: trigger.interviewee_discord_id, name: trigger.interviewee_name };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO round_exclusions (week_id, participant_id, reason, created_at)
       VALUES (?1, ?2, 'scheduling_inactivity', ?3)`,
    ).bind(trigger.week_id, inactiveId, now.toISOString()),
    env.DB.prepare('DELETE FROM optins WHERE week_id = ?1 AND participant_id = ?2')
      .bind(trigger.week_id, inactiveId),
    env.DB.prepare(
      "UPDATE repair_queue SET state = 'expired' WHERE week_id = ?1 AND participant_id = ?2 AND state = 'open'",
    ).bind(trigger.week_id, inactiveId),
  ]);

  const { results: affected } = await env.DB.prepare(
    `SELECT id, week_id, interviewer_id, interviewee_id, thread_id
     FROM sessions
     WHERE week_id = ?1 AND state = 'pending_schedule'
       AND (interviewer_id = ?2 OR interviewee_id = ?2)
     ORDER BY id`,
  ).bind(trigger.week_id, inactiveId).all<{
    id: number;
    week_id: number;
    interviewer_id: number;
    interviewee_id: number;
    thread_id: string | null;
  }>();

  let partnersQueued = 0;
  for (const session of affected) {
    const closed = await env.DB.prepare(
      "UPDATE sessions SET state = 'broken', activity_checked_at = ?2 WHERE id = ?1 AND state = 'pending_schedule'",
    ).bind(session.id, now.toISOString()).run();
    if (Number(closed.meta.changes ?? 0) === 0) continue;

    const inactiveWasInterviewer = session.interviewer_id === inactiveId;
    const partnerId = inactiveWasInterviewer ? session.interviewee_id : session.interviewer_id;
    const need = inactiveWasInterviewer ? 'interviewer' : 'interviewee';
    const existingRepair = await env.DB.prepare(
      `SELECT id FROM repair_queue
       WHERE week_id = ?1 AND participant_id = ?2 AND need = ?3 AND state = 'open'
       LIMIT 1`,
    ).bind(session.week_id, partnerId, need).first<{ id: number }>();
    if (!existingRepair) {
      await enqueueRepair(env, session.week_id, partnerId, need);
      partnersQueued++;
    }

    const partner = await env.DB.prepare(
      'SELECT discord_id FROM participants WHERE id = ?1',
    ).bind(partnerId).first<{ discord_id: string }>();
    const threadMessage =
      `⏱️ This unscheduled session is closing after 72 hours. ` +
      `<@${inactive.discordId}> did not participate after the reminder and is out of new pairings for Round ${trigger.week_idx}. ` +
      `${partner ? `<@${partner.discord_id}> has` : 'Their partner has'} been queued for re-pairing.`;
    await closeSessionThread(env, session, threadMessage, 'closed');
    if (partner?.discord_id) {
      await enqueue(env, 'dm', {
        userId: partner.discord_id,
        fallbackKind: 'repair_pairing',
        message: {
          content:
            `🛠️ **Your unscheduled Round ${trigger.week_idx} partner did not respond within 72 hours.** ` +
            `That session was closed and you are in priority re-pairing. I'll message you when a compatible partner is available.`,
        },
      });
    }
  }

  await enqueue(env, 'dm', {
    userId: inactive.discordId,
    fallbackKind: 'round_inactivity_removal',
    message: {
      content:
        `⏱️ You were removed from **Round ${trigger.week_idx}'s unscheduled pairings** because you did not participate ` +
        `in scheduling within 72 hours. You will not receive another pairing this round; any session you already scheduled is unchanged. ` +
        `Contact an organizer if this was a mistake.`,
    },
  });

  const { organizer_channel_id } = await getSettings(env, ['organizer_channel_id']);
  if (organizer_channel_id) {
    await enqueue(env, 'channel_msg', {
      channelId: organizer_channel_id,
      message: {
        content:
          `⏱️ **${inactive.name ?? inactive.discordId}** (<@${inactive.discordId}>) was removed from Round ${trigger.week_idx}'s ` +
          `unscheduled pairings after 72 hours of scheduling inactivity; ${affected.length} unscheduled session(s) closed and ` +
          `${partnersQueued} new re-pair queue entr${partnersQueued === 1 ? 'y' : 'ies'} created` +
          (trigger.thread_id ? ` · **Thread:** <#${trigger.thread_id}>` : ''),
        allowed_mentions: { parse: [] },
      },
    });
  }
}
