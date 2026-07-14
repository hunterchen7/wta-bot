import { getSettings } from '../config';
import { buttonRow } from '../discord/components';
import type { Env } from '../env';
import { enqueue } from './outbox';
import { strikesOf } from './progress';
import { enqueueRepair } from './repair';

// No-show machinery (DESIGN §4): detection → ledger → strikes → case files.
// Reports are confirmed on arrival (dispute flips them back to open); the
// second confirmed strike assembles a case file and holds the person —
// removal is always a human click.

export type IncidentKind = 'ghost' | 'unresponsive' | 'late_cancel' | 'issue';

type SessionRow = {
  id: number;
  week_id: number;
  interviewer_id: number;
  interviewee_id: number;
  thread_id: string | null;
  state: string;
  origin: 'match' | 'repair' | 'manual';
  scheduled_at: string | null;
  packet_sent_at: string | null;
};

export async function getSession(env: Env, sessionId: number): Promise<SessionRow | null> {
  return env.DB.prepare('SELECT * FROM sessions WHERE id = ?1').bind(sessionId).first<SessionRow>();
}

async function participantByDiscord(env: Env, discordId: string) {
  return env.DB.prepare('SELECT id, discord_id, name FROM participants WHERE discord_id = ?1')
    .bind(discordId)
    .first<{ id: number; discord_id: string; name: string | null }>();
}

async function discordIdOf(env: Env, participantId: number): Promise<string | null> {
  const row = await env.DB.prepare('SELECT discord_id FROM participants WHERE id = ?1')
    .bind(participantId)
    .first<{ discord_id: string }>();
  return row?.discord_id ?? null;
}

/** Report a partner no-show/unresponsive, or self-report a late cancel. */
export async function reportIncident(
  env: Env,
  session: SessionRow,
  kind: Exclude<IncidentKind, 'issue'>,
  reporterDiscordId: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const reporter = await participantByDiscord(env, reporterDiscordId);
  if (!reporter) return { ok: false, message: "You're not on the roster." };
  const isInterviewer = session.interviewer_id === reporter.id;
  const isInterviewee = session.interviewee_id === reporter.id;
  if (!isInterviewer && !isInterviewee) {
    return { ok: false, message: 'Only the two session participants can report on it.' };
  }

  // late_cancel: the reporter is the one cancelling; otherwise the partner is accused.
  const accusedId =
    kind === 'late_cancel'
      ? reporter.id
      : isInterviewer
        ? session.interviewee_id
        : session.interviewer_id;
  const victimId = accusedId === session.interviewer_id ? session.interviewee_id : session.interviewer_id;

  const ins = await env.DB.prepare(
    `INSERT INTO incidents (session_id, accused_id, reporter_id, kind, state)
     VALUES (?1, ?2, ?3, ?4, 'confirmed')`,
  )
    .bind(session.id, accusedId, reporter.id, kind)
    .run();
  const incidentId = Number(ins.meta.last_row_id);

  await env.DB.prepare("UPDATE sessions SET state = 'broken' WHERE id = ?1").bind(session.id).run();

  // Victim gets priority repair: they lost the side the accused was playing.
  const victimNeeds = accusedId === session.interviewer_id ? 'interviewer' : 'interviewee';
  await enqueueRepair(env, session.week_id, victimId, victimNeeds);

  const accusedDiscord = await discordIdOf(env, accusedId);

  if (kind === 'late_cancel') {
    if (session.thread_id) {
      await enqueue(env, 'channel_msg', {
        channelId: session.thread_id,
        message: { content: `📅 Session cancelled by <@${reporter.discord_id}> (with notice). The partner has been re-queued for a repair pairing.` },
      });
    }
    return { ok: true, message: "Cancelled — your partner is being re-paired. Cancelling with notice is recorded, but it's softer than a no-show." };
  }

  // Notify the accused + dispute path
  if (accusedDiscord) {
    await enqueue(env, 'dm', {
      userId: accusedDiscord,
      fallbackKind: 'incident_notice',
      message: {
        content:
          `⚠️ You were reported as **${kind === 'ghost' ? 'a no-show' : 'unresponsive'}** for a WTA session. ` +
          `Your partner has been re-paired. If this is wrong, hit dispute — organizers review everything.`,
        components: [buttonRow([{ id: `dispute:${incidentId}`, label: 'Dispute this', style: 2 }])],
      },
    });
  }

  await applyStrikeLadder(env, accusedId, incidentId);
  return {
    ok: true,
    message: 'Reported — sorry that happened. You get priority for a same-week repair pairing; watch for a new thread.',
  };
}

async function applyStrikeLadder(env: Env, accusedId: number, incidentId: number): Promise<void> {
  const strikes = await strikesOf(env, accusedId);
  const accusedDiscord = await discordIdOf(env, accusedId);
  const cfg = await getSettings(env, ['organizer_channel_id']);

  if (strikes <= 1) {
    if (accusedDiscord) {
      await enqueue(env, 'dm', {
        userId: accusedDiscord,
        fallbackKind: 'strike_warning',
        message: {
          content:
            '🟡 **First miss on record.** Per WTA policy you\'ll be rescheduled — but a second confirmed no-show means removal from the program (organizers review every case). Reply to your organizers if there was a good reason.',
        },
      });
    }
    return;
  }

  // Strike 2+: hold + case file. Removal is a human decision.
  await env.DB.prepare("UPDATE participants SET status = 'held' WHERE id = ?1").bind(accusedId).run();

  if (cfg.organizer_channel_id) {
    const { results: history } = await env.DB.prepare(
      `SELECT i.kind, i.state, i.created_at, s.week_id FROM incidents i
       LEFT JOIN sessions s ON s.id = i.session_id
       WHERE i.accused_id = ?1 ORDER BY i.id`,
    )
      .bind(accusedId)
      .all<any>();
    const lines = history.map((h) => `• ${h.kind} (${h.state}) — ${String(h.created_at).slice(0, 10)}`);
    await enqueue(env, 'channel_msg', {
      channelId: cfg.organizer_channel_id,
      message: {
        content:
          `🔴 **Case file:** <@${accusedDiscord}> hit strike ${strikes}. They're **held** out of matching pending your call.\n${lines.join('\n')}`,
        components: [
          buttonRow([
            { id: `case:${accusedId}:remove`, label: 'Remove from program', style: 4 },
            { id: `case:${accusedId}:excuse:${incidentId}`, label: 'Excuse this incident', style: 2 },
            { id: `case:${accusedId}:keep`, label: 'Warn & keep', style: 1 },
          ]),
        ],
      },
    });
  }
  if (accusedDiscord) {
    await enqueue(env, 'dm', {
      userId: accusedDiscord,
      fallbackKind: 'strike_hold',
      message: {
        content:
          '🔴 **Second confirmed miss.** Per WTA policy your participation is on hold while organizers review — reply to them with any context. You\'re out of matching until they decide.',
      },
    });
  }
}

/** Organizer case-file actions. Returns the message to show. */
export async function resolveCase(
  env: Env,
  accusedId: number,
  action: 'remove' | 'excuse' | 'keep',
  incidentId?: number,
): Promise<string> {
  const accusedDiscord = await discordIdOf(env, accusedId);
  if (action === 'remove') {
    await env.DB.prepare("UPDATE participants SET status = 'removed' WHERE id = ?1").bind(accusedId).run();
    if (accusedDiscord) {
      await enqueue(env, 'dm', {
        userId: accusedDiscord,
        fallbackKind: 'removed',
        message: { content: 'You\'ve been removed from this WTA cohort after repeated no-shows. If you think this is a mistake, contact the organizers — and you\'re welcome to re-join a future cohort.' },
      });
    }
    return `Removed <@${accusedDiscord}> from the program.`;
  }
  if (action === 'excuse') {
    if (incidentId) {
      await env.DB.prepare("UPDATE incidents SET state = 'excused' WHERE id = ?1").bind(incidentId).run();
    }
    const remaining = await strikesOf(env, accusedId);
    if (remaining < 2) {
      await env.DB.prepare("UPDATE participants SET status = 'active' WHERE id = ?1 AND status = 'held'")
        .bind(accusedId)
        .run();
    }
    if (accusedDiscord) {
      await enqueue(env, 'dm', {
        userId: accusedDiscord,
        fallbackKind: 'excused',
        message: { content: '🟢 An organizer excused your recent incident — you\'re back in the pool. See you next opt-in!' },
      });
    }
    return `Excused incident${incidentId ? ` #${incidentId}` : ''} for <@${accusedDiscord}> (${remaining} strike(s) remain).`;
  }
  // keep
  await env.DB.prepare("UPDATE participants SET status = 'active' WHERE id = ?1 AND status = 'held'")
    .bind(accusedId)
    .run();
  if (accusedDiscord) {
    await enqueue(env, 'dm', {
      userId: accusedDiscord,
      fallbackKind: 'kept',
      message: { content: '🟠 Organizers reviewed your case: you\'re staying in the program with a final warning. Next confirmed no-show is removal.' },
    });
  }
  return `Kept <@${accusedDiscord}> with a final warning (released from hold).`;
}

/** The accused disputes: incident back to open + organizers pinged. */
export async function disputeIncident(env: Env, incidentId: number, discordId: string): Promise<string> {
  const incident = await env.DB.prepare('SELECT i.*, p.discord_id AS accused_discord FROM incidents i JOIN participants p ON p.id = i.accused_id WHERE i.id = ?1')
    .bind(incidentId)
    .first<any>();
  if (!incident || incident.accused_discord !== discordId) return 'This dispute button isn\'t yours.';
  await env.DB.prepare("UPDATE incidents SET state = 'open' WHERE id = ?1").bind(incidentId).run();
  const cfg = await getSettings(env, ['organizer_channel_id']);
  if (cfg.organizer_channel_id) {
    await enqueue(env, 'channel_msg', {
      channelId: cfg.organizer_channel_id,
      message: { content: `⚖️ <@${discordId}> **disputes** incident #${incidentId} (${incident.kind}). Use \`/excuse\` to clear it or the case-file buttons to rule.` },
    });
  }
  return 'Dispute recorded — organizers have been pinged and will review.';
}
