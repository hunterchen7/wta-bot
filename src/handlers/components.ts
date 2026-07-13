// Button / select / modal handlers for the weekly cycle, verification gate,
// and incident case files. Routed from interactions.ts by custom_id prefix.

import type { Context } from 'hono';
import { getSetting, getSettings } from '../config';
import { buttonRow, ephemeral, modal, stringSelect, textInput } from '../discord/components';
import { disputeIncident, getSession, reportIncident, resolveCase } from '../engine/incidents';
import { enqueue } from '../engine/outbox';
import type { Env } from '../env';
import { getParticipant } from '../participants';
import { discordTime, formatToronto, parseTorontoLocal, torontoDateKey } from '../time';
import {
  collectModalValues,
  type Interaction,
  interactionUser,
  ResponseType,
} from '../discord/types';
import { ENROLLMENT_BUTTON_ID } from '../discord/enrollment';
import { enrollmentLinkResponse } from './enrollment';
import { isOrganizer } from './shared';

type Ctx = Context<{ Bindings: Env }>;

export async function handleComponent(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction);
  if (!user) return c.json(ephemeral('Could not identify you — try again.'));
  const id = interaction.data?.custom_id ?? '';

  // ---- persistent program enrollment ---------------------------------------
  if (id === ENROLLMENT_BUTTON_ID) return enrollmentLinkResponse(c, interaction);

  // ---- weekly opt-in ------------------------------------------------------
  const optin = /^optin:(\d+):(in|double|standby|out)$/.exec(id);
  if (optin) return handleOptin(c, interaction, Number(optin[1]), optin[2] as any);

  // ---- session thread buttons ---------------------------------------------
  const sess = /^sess:(\d+):(sched|cancel|noshow|cancel-confirm|noshow-confirm|action-dismiss)$/.exec(id);
  if (sess) return handleSessionButton(c, interaction, Number(sess[1]), sess[2] as any);

  // ---- incident case-file buttons (organizers) ----------------------------
  const caseAction = /^case:(\d+):(remove|keep)$/.exec(id);
  const caseExcuse = /^case:(\d+):excuse:(\d+)$/.exec(id);
  if (caseAction || caseExcuse) {
    if (!(await isOrganizer(c.env, interaction))) return c.json(ephemeral('Organizers only.'));
    const accusedId = Number((caseAction ?? caseExcuse)![1]);
    const action = caseAction ? (caseAction[2] as 'remove' | 'keep') : 'excuse';
    const message = await resolveCase(c.env, accusedId, action, caseExcuse ? Number(caseExcuse[2]) : undefined);
    // Update the case-file message in place so double-clicks are obvious.
    return c.json({
      type: ResponseType.UPDATE_MESSAGE,
      data: { content: `✅ ${message} (by <@${user.id}>)`, components: [] },
    });
  }

  const dispute = /^dispute:(\d+)$/.exec(id);
  if (dispute) {
    const message = await disputeIncident(c.env, Number(dispute[1]), user.id);
    return c.json(ephemeral(message));
  }

  // ---- rejoin after self-withdrawal ------------------------------------------
  if (id === 'rejoin:confirm') {
    const p = await c.env.DB.prepare(
      "SELECT id, name FROM participants WHERE discord_id = ?1 AND status = 'removed' AND removed_reason = 'withdrew'",
    )
      .bind(user.id)
      .first<{ id: number; name: string | null }>();
    if (!p) return c.json(ephemeral('Nothing to rejoin — run `/join` normally.'));
    await c.env.DB.prepare(
      "UPDATE participants SET status = 'active', removed_reason = NULL WHERE id = ?1",
    )
      .bind(p.id)
      .run();
    const cfg = await getSettings(c.env, ['organizer_channel_id']);
    if (cfg.organizer_channel_id) {
      await enqueue(c.env, 'channel_msg', {
        channelId: cfg.organizer_channel_id,
        message: { content: `🔄 **${p.name ?? user.id}** (<@${user.id}>) rejoined the program — history intact, deficits will surface at the next opt-in.` },
      });
    }
    return c.json({
      type: ResponseType.UPDATE_MESSAGE,
      data: {
        content: '🎉 **You\'re back in!** Everything picked up where you left off. Watch for the next round\'s opt-in — if you\'re behind pace, grab the **catch-up double** button to make up missed interviews.',
        components: [],
      },
    });
  }

  // ---- permanent withdrawal -------------------------------------------------
  if (id === 'leave:cancel') {
    return c.json({
      type: ResponseType.UPDATE_MESSAGE,
      data: { content: '👍 Staying in — see you at the next opt-in.', components: [] },
    });
  }
  if (id === 'leave:confirm') {
    const p = await getParticipant(c.env, user.id);
    if (!p) return c.json(ephemeral('Not enrolled.'));
    const summary = await withdrawParticipant(c.env, p.id, user.id);
    return c.json({
      type: ResponseType.UPDATE_MESSAGE,
      data: {
        content: `✅ You've left the program. ${summary} Your history is kept — if you change your mind, just run \`/join\` and hit Rejoin. 👋`,
        components: [],
      },
    });
  }

  const swap = /^swap:(\d+)$/.exec(id);
  if (swap) {
    return c.json(ephemeral('Problem swapping is no longer available. Use the assigned problem for this session.'));
  }

  return c.json(ephemeral('🚧 Not implemented yet.'));
}

export async function handleModal(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction);
  if (!user) return c.json(ephemeral('Could not identify you — try again.'));
  const id = interaction.data?.custom_id ?? '';
  const values = collectModalValues(interaction.data?.components);

  // ---- session scheduling --------------------------------------------------
  const sched = /^sess:(\d+):schedmodal$/.exec(id);
  if (sched) return handleScheduleSubmit(c, interaction, Number(sched[1]), values);

  return c.json(ephemeral('🚧 Not implemented yet.'));
}

// ---------------------------------------------------------------------------

async function handleOptin(
  c: Ctx,
  interaction: Interaction,
  weekId: number,
  choice: 'in' | 'double' | 'standby' | 'out',
) {
  const user = interactionUser(interaction)!;
  const participant = await getParticipant(c.env, user.id);
  if (!participant || participant.topics === null) {
    return c.json(ephemeral("You're not enrolled yet — run `/join` first (takes ~a minute)."));
  }
  if (participant.status !== 'active') {
    return c.json(ephemeral('Your participation is currently on hold — contact the organizers.'));
  }
  if (participant.pairing_excluded === 1 || await isOrganizer(c.env, interaction)) {
    const { excludeOrganizerFromPairing } = await import('../organizers');
    await excludeOrganizerFromPairing(c.env, participant.id);
    return c.json(ephemeral('Organizers aren\'t included in participant matching. You can still use the dashboard and form previews.'));
  }
  const week = await c.env.DB.prepare('SELECT * FROM weeks WHERE id = ?1').bind(weekId).first<any>();
  if (!week) return c.json(ephemeral('This opt-in has expired.'));
  const now = new Date();
  if (now > new Date(week.optin_closes_at)) {
    return c.json(ephemeral(`Opt-in for round ${week.idx} closed ${discordTime(week.optin_closes_at, 'R')}. If you're stranded, organizers can pair you manually.`));
  }

  if (choice === 'out') {
    const optin = await c.env.DB.prepare(
      'SELECT extra_interviewer FROM optins WHERE week_id = ?1 AND participant_id = ?2',
    ).bind(weekId, participant.id).first<{ extra_interviewer: number }>();
    if (optin?.extra_interviewer === 1) {
      await c.env.DB.prepare(
        `UPDATE optins SET regular_opt_in = 0, standby = 0, wants_double = 0
         WHERE week_id = ?1 AND participant_id = ?2`,
      ).bind(weekId, participant.id).run();
    } else {
      await c.env.DB.prepare('DELETE FROM optins WHERE week_id = ?1 AND participant_id = ?2')
        .bind(weekId, participant.id)
        .run();
    }
    return c.json(ephemeral(`Sitting out round ${week.idx} — no penalty. Catch up with a double later if you like.`));
  }

  await c.env.DB.prepare(
    `INSERT INTO optins (week_id, participant_id, standby, wants_double, regular_opt_in)
     VALUES (?1, ?2, ?3, ?4, 1)
     ON CONFLICT(week_id, participant_id) DO UPDATE SET standby = ?3, wants_double = ?4, regular_opt_in = 1`,
  )
    .bind(weekId, participant.id, choice === 'standby' ? 1 : 0, choice === 'double' ? 1 : 0)
    .run();
  const label =
    choice === 'in' ? "You're in" : choice === 'double' ? "You're in with a catch-up double (if you're behind)" : "You're in, plus standby for extra sessions";
  return c.json(ephemeral(`✅ ${label} for round ${week.idx}. Pairings drop ${discordTime(week.match_at)}.`));
}

async function handleSessionButton(
  c: Ctx,
  interaction: Interaction,
  sessionId: number,
  action: 'sched' | 'cancel' | 'noshow' | 'cancel-confirm' | 'noshow-confirm' | 'action-dismiss',
) {
  const user = interactionUser(interaction)!;
  const session = await getSession(c.env, sessionId);
  if (!session) return c.json(ephemeral('Session not found.'));
  const me = await getParticipant(c.env, user.id);
  const mine = me && (session.interviewer_id === me.id || session.interviewee_id === me.id);
  if (!mine && !(await isOrganizer(c.env, interaction))) {
    return c.json(ephemeral('Only the two session participants (or organizers) can use these.'));
  }

  if (action === 'sched') {
    if (session.state === 'broken' || session.state === 'cancelled') {
      return c.json(ephemeral('This session was cancelled/broken — it can\'t be scheduled.'));
    }
    const week = await c.env.DB.prepare('SELECT * FROM weeks WHERE id = ?1').bind(session.week_id).first<any>();
    if (!week) return c.json(ephemeral('This round no longer exists.'));
    const dateOptions = schedulingDateOptions(week, session, new Date());
    if (!dateOptions.length) return c.json(ephemeral('There are no legal scheduling dates left in this round. Contact an organizer.'));
    const rescheduling = session.state === 'scheduled';
    return c.json(modal(`sess:${sessionId}:schedmodal`, rescheduling ? 'Reschedule your session' : 'Schedule your session', [
      stringSelect({ id: 'date', label: 'Date (Toronto)', description: schedulingWindowDescription(week, session), options: dateOptions }),
      textInput({
        id: 'time',
        label: 'Time (24-hour, Toronto)',
        description: 'Enter a time such as 09:10 or 19:45.',
        placeholder: '19:30',
        value: rescheduling && session.scheduled_at
          ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(session.scheduled_at))
          : undefined,
        minLength: 5,
        maxLength: 5,
      }),
    ]));
  }

  if (session.state === 'broken' || session.state === 'cancelled') {
    return c.json(ephemeral('Already handled — this session is closed.'));
  }
  if (action === 'action-dismiss') {
    return c.json({
      type: ResponseType.UPDATE_MESSAGE,
      data: { content: 'No changes made. The session is still open.', components: [] },
    });
  }
  if (action === 'cancel' || action === 'noshow') {
    const cancelling = action === 'cancel';
    return c.json(ephemeral(
      cancelling
        ? '**Confirm that you cannot make this session.** This closes the session, records that you cancelled, and puts your partner into the priority repair queue.'
        : '**Confirm this no-show report.** This closes the session, records a no-show against your partner, and puts you into the priority repair queue. Only continue if they missed the agreed session.',
      [buttonRow([
        { id: `sess:${sessionId}:${cancelling ? 'cancel-confirm' : 'noshow-confirm'}`, label: cancelling ? 'Yes, I cannot make it' : 'Confirm no-show', style: 4 },
        { id: `sess:${sessionId}:action-dismiss`, label: 'Go back', style: 2 },
      ])],
    ));
  }
  const result = await reportIncident(c.env, session, action === 'cancel-confirm' ? 'late_cancel' : 'ghost', user.id);
  return c.json(ephemeral(result.message));
}

async function handleScheduleSubmit(c: Ctx, interaction: Interaction, sessionId: number, values: Map<string, string | string[]>) {
  const session = await getSession(c.env, sessionId);
  if (!session) return c.json(ephemeral('Session not found.'));
  const user = interactionUser(interaction)!;
  const me = await getParticipant(c.env, user.id);
  const mine = me && (session.interviewer_id === me.id || session.interviewee_id === me.id);
  if (!mine && !(await isOrganizer(c.env, interaction))) {
    return c.json(ephemeral('Only the two session participants (or organizers) can schedule this session.'));
  }
  if (session.state === 'broken' || session.state === 'cancelled') {
    return c.json(ephemeral('This session was cancelled/broken — it can\'t be scheduled.'));
  }
  const week = await c.env.DB.prepare('SELECT * FROM weeks WHERE id = ?1').bind(session.week_id).first<any>();
  if (!week) return c.json(ephemeral('This round no longer exists.'));
  const date = modalValue(values, 'date');
  const time = modalValue(values, 'time').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return c.json(ephemeral('Enter a valid time in 24-hour format, such as `09:10` or `19:45`.'));
  }
  const when = parseTorontoLocal(`${date} ${time}`);
  if (!when) return c.json(ephemeral('That date does not exist in Toronto time. Choose another date.'));
  const now = new Date();
  const windowStart = session.origin === 'manual' ? now : new Date(week.match_at);
  const deadline = new Date(week.grace_until ?? week.reports_due_at);
  if (when.getTime() < now.getTime() - 60_000) {
    return c.json(ephemeral('That time is in the past — pick something upcoming.'));
  }
  if (when < windowStart) {
    return c.json(ephemeral(`That is before this session's scheduling window opens (${formatToronto(windowStart)} Toronto).`));
  }
  if (when > deadline) {
    return c.json(ephemeral(`That's past the round deadline (${formatToronto(deadline)} Toronto). Pick an earlier slot.`));
  }
  const wasScheduled = session.state === 'scheduled';
  await c.env.DB.prepare(
    "UPDATE sessions SET scheduled_at = ?1, state = 'scheduled', reminder_sent_at = NULL, forms_released_at = NULL WHERE id = ?2",
  )
    .bind(when.toISOString(), sessionId)
    .run();
  let problemSent = false;
  if ((await getSetting(c.env, 'packet_mode')) === 'on') {
    const { deliverSessionProblem } = await import('../engine/problems');
    const origin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin;
    problemSent = await deliverSessionProblem(c.env, sessionId, origin);
  }
  // Non-ephemeral: the confirmation belongs to both partners in the thread.
  return c.json({
    type: ResponseType.CHANNEL_MESSAGE,
    data: {
      content:
        `📅 ${wasScheduled ? 'Rescheduled' : 'Locked in'}: ${discordTime(when)} (${formatToronto(when)} Toronto). ` +
        `${problemSent ? 'The interviewer packet has been sent by DM. ' : ''}` +
        `Report forms arrive here + by DM at session time.\n\nNeed another time? Either participant can use **Reschedule time** below.`,
      components: [buttonRow([{ id: `sess:${sessionId}:sched`, label: 'Reschedule time', style: 1 }])],
    },
  });
}

function modalValue(values: Map<string, string | string[]>, key: string): string {
  const value = values.get(key);
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function schedulingWindowDescription(week: any, session: { origin?: string }): string {
  const start = session.origin === 'manual' ? new Date() : new Date(week.match_at);
  const end = new Date(week.grace_until ?? week.reports_due_at);
  return `${formatToronto(start)} through ${formatToronto(end)}`.slice(0, 100);
}

function schedulingDateOptions(week: any, session: { origin?: string; scheduled_at?: string | null }, now: Date) {
  const startsAt = session.origin === 'manual'
    ? now
    : new Date(Math.max(now.getTime(), new Date(week.match_at).getTime()));
  const endsAt = new Date(week.grace_until ?? week.reports_due_at);
  const first = torontoDateKey(startsAt);
  const last = torontoDateKey(endsAt);
  const scheduledDate = typeof session.scheduled_at === 'string'
    ? torontoDateKey(new Date(session.scheduled_at))
    : null;
  const options: Array<{ label: string; value: string; description?: string; default?: boolean }> = [];
  for (let cursor = new Date(`${first}T12:00:00Z`); options.length < 25; cursor = new Date(cursor.getTime() + 86400_000)) {
    const value = cursor.toISOString().slice(0, 10);
    if (value > last) break;
    options.push({
      value,
      label: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', weekday: 'short', month: 'short', day: 'numeric' }).format(cursor),
      default: scheduledDate ? value === scheduledDate : options.length === 0,
    });
  }
  return options;
}

/** Self-serve program withdrawal: cancel open sessions, repair-queue the
 *  partners, clear future opt-ins, note to organizers. History stays. */
async function withdrawParticipant(env: Env, participantId: number, discordId: string): Promise<string> {
  const { enqueueRepair } = await import('../engine/repair');
  const nowIso = new Date().toISOString();

  const { results: open } = await env.DB.prepare(
    `SELECT id, week_id, interviewer_id, interviewee_id, thread_id FROM sessions
     WHERE state IN ('pending_schedule', 'scheduled') AND (interviewer_id = ?1 OR interviewee_id = ?1)`,
  )
    .bind(participantId)
    .all<any>();

  for (const s of open) {
    await env.DB.prepare("UPDATE sessions SET state = 'cancelled' WHERE id = ?1").bind(s.id).run();
    const partnerId = s.interviewer_id === participantId ? s.interviewee_id : s.interviewer_id;
    // The partner needs a replacement for the role the withdrawer played.
    const need = s.interviewer_id === participantId ? 'interviewer' : 'interviewee';
    await enqueueRepair(env, s.week_id, partnerId, need);
    if (s.thread_id) {
      await enqueue(env, 'channel_msg', {
        channelId: s.thread_id,
        message: { content: '📕 This session was cancelled — one participant left the program. The other has been queued for a repair pairing.' },
      });
    }
  }

  await env.DB.prepare(
    `DELETE FROM optins WHERE participant_id = ?1
       AND week_id IN (SELECT id FROM weeks WHERE match_at > ?2)`,
  )
    .bind(participantId, nowIso)
    .run();
  await env.DB.prepare(
    "UPDATE participants SET status = 'removed', removed_reason = 'withdrew' WHERE id = ?1",
  )
    .bind(participantId)
    .run();

  const cfg = await getSettings(env, ['organizer_channel_id']);
  if (cfg.organizer_channel_id) {
    await enqueue(env, 'channel_msg', {
      channelId: cfg.organizer_channel_id,
      message: { content: `📕 <@${discordId}> **withdrew from the program** (self-serve). ${open.length} open session(s) cancelled, partners re-queued.` },
    });
  }
  return open.length
    ? `${open.length} open session(s) were cancelled and your partners are being re-paired.`
    : 'You had no open sessions to clean up.';
}
