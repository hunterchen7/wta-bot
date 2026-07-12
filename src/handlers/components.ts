// Button / select / modal handlers for the weekly cycle, verification gate,
// and incident case files. Routed from interactions.ts by custom_id prefix.

import type { Context } from 'hono';
import { getSetting, getSettings, setSetting } from '../config';
import { buttonRow, ephemeral, modal, textInput, TextStyle } from '../discord/components';
import { disputeIncident, getSession, reportIncident, resolveCase } from '../engine/incidents';
import { enqueue } from '../engine/outbox';
import type { Env } from '../env';
import * as intake from '../intake';
import { getParticipant, upsertParticipant } from '../participants';
import { discordTime, formatToronto, parseTorontoLocal } from '../time';
import {
  collectModalValues,
  type Interaction,
  interactionUser,
  ResponseType,
} from '../discord/types';
import { isOrganizer } from './shared';

type Ctx = Context<{ Bindings: Env }>;

export async function handleComponent(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction);
  if (!user) return c.json(ephemeral('Could not identify you — try again.'));
  const id = interaction.data?.custom_id ?? '';

  // ---- intake continue buttons -------------------------------------------
  if (id === intake.IDS.continue2 || id === intake.IDS.continue3) {
    const existing = await getParticipant(c.env, user.id);
    return c.json(id === intake.IDS.continue2 ? intake.modal2(existing) : intake.modal3(existing));
  }

  // ---- weekly opt-in ------------------------------------------------------
  const optin = /^optin:(\d+):(in|double|standby|out)$/.exec(id);
  if (optin) return handleOptin(c, interaction, Number(optin[1]), optin[2] as any);

  // ---- session thread buttons ---------------------------------------------
  const sess = /^sess:(\d+):(sched|cancel|noshow)$/.exec(id);
  if (sess) return handleSessionButton(c, interaction, Number(sess[1]), sess[2] as any);

  // ---- verification gate --------------------------------------------------
  if (id === 'verify:start') {
    return c.json(
      modal('verify:modal', 'Welcome to Western Tech Alumni!', [
        textInput({ id: 'name', label: 'Your name', maxLength: 64 }),
        textInput({
          id: 'why',
          label: 'What brings you here?',
          description: 'One line is plenty',
          style: TextStyle.PARAGRAPH,
          required: false,
          maxLength: 300,
        }),
      ]),
    );
  }

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

  return c.json(ephemeral('🚧 Not implemented yet.'));
}

export async function handleModal(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction);
  if (!user) return c.json(ephemeral('Could not identify you — try again.'));
  const id = interaction.data?.custom_id ?? '';
  const values = collectModalValues(interaction.data?.components);

  // ---- intake modals -------------------------------------------------------
  if (id === intake.IDS.modal1) {
    const fields = intake.parseModal1(values);
    await upsertParticipant(c.env, user.id, fields);
    if (fields.name && interaction.guild_id) {
      await enqueue(c.env, 'nickname', {
        guildId: interaction.guild_id,
        userId: user.id,
        nick: fields.name.trim().slice(0, 32),
      });
    }
    return c.json(intake.afterModal1());
  }
  if (id === intake.IDS.modal2) {
    await upsertParticipant(c.env, user.id, intake.parseModal2(values));
    return c.json(intake.afterModal2());
  }
  if (id === intake.IDS.modal3) {
    await upsertParticipant(c.env, user.id, intake.parseModal3(values));
    await onEnrollmentComplete(c, interaction, user.id);
    return c.json(intake.afterModal3());
  }

  // ---- session scheduling --------------------------------------------------
  const sched = /^sess:(\d+):schedmodal$/.exec(id);
  if (sched) return handleScheduleSubmit(c, interaction, Number(sched[1]), values);

  // ---- verification gate ---------------------------------------------------
  if (id === 'verify:modal') return handleVerifySubmit(c, interaction, values);

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
  const week = await c.env.DB.prepare('SELECT * FROM weeks WHERE id = ?1').bind(weekId).first<any>();
  if (!week) return c.json(ephemeral('This opt-in has expired.'));
  const now = new Date();
  if (now > new Date(week.optin_closes_at)) {
    return c.json(ephemeral(`Opt-in for week ${week.idx} closed ${discordTime(week.optin_closes_at, 'R')}. If you're stranded, organizers can pair you manually.`));
  }

  if (choice === 'out') {
    await c.env.DB.prepare('DELETE FROM optins WHERE week_id = ?1 AND participant_id = ?2')
      .bind(weekId, participant.id)
      .run();
    return c.json(ephemeral(`Sitting out week ${week.idx} — no penalty. Catch up with a double later if you like.`));
  }

  await c.env.DB.prepare(
    `INSERT INTO optins (week_id, participant_id, standby, wants_double)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(week_id, participant_id) DO UPDATE SET standby = ?3, wants_double = ?4`,
  )
    .bind(weekId, participant.id, choice === 'standby' ? 1 : 0, choice === 'double' ? 1 : 0)
    .run();
  const label =
    choice === 'in' ? "You're in" : choice === 'double' ? "You're in with a catch-up double (if you're behind)" : "You're in, plus standby for extra sessions";
  return c.json(ephemeral(`✅ ${label} for week ${week.idx}. Pairings drop ${discordTime(week.match_at)}.`));
}

async function handleSessionButton(
  c: Ctx,
  interaction: Interaction,
  sessionId: number,
  action: 'sched' | 'cancel' | 'noshow',
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
    return c.json(
      modal(`sess:${sessionId}:schedmodal`, 'Confirm your session time', [
        textInput({
          id: 'when',
          label: 'When? (Toronto time)',
          description: 'Format: YYYY-MM-DD HH:mm — e.g. 2026-09-16 19:30',
          placeholder: '2026-09-16 19:30',
          maxLength: 20,
        }),
      ]),
    );
  }

  if (session.state === 'broken' || session.state === 'cancelled') {
    return c.json(ephemeral('Already handled — this session is closed.'));
  }
  const result = await reportIncident(c.env, session, action === 'cancel' ? 'late_cancel' : 'ghost', user.id);
  return c.json(ephemeral(result.message));
}

async function handleScheduleSubmit(c: Ctx, interaction: Interaction, sessionId: number, values: Map<string, string | string[]>) {
  const raw = String(values.get('when') ?? '');
  const when = parseTorontoLocal(raw);
  if (!when) {
    return c.json(ephemeral(`Couldn't parse \`${raw}\` — use \`YYYY-MM-DD HH:mm\` (Toronto), e.g. \`2026-09-16 19:30\`.`));
  }
  const session = await getSession(c.env, sessionId);
  if (!session) return c.json(ephemeral('Session not found.'));
  const week = await c.env.DB.prepare('SELECT * FROM weeks WHERE id = ?1').bind(session.week_id).first<any>();
  const deadline = new Date(week.grace_until ?? week.reports_due_at);
  if (when.getTime() < Date.now() - 3600_000) {
    return c.json(ephemeral('That time is in the past — pick something upcoming.'));
  }
  if (when > deadline) {
    return c.json(ephemeral(`That's past the week's deadline (${formatToronto(deadline)} Toronto). Pick an earlier slot.`));
  }
  await c.env.DB.prepare("UPDATE sessions SET scheduled_at = ?1, state = 'scheduled' WHERE id = ?2")
    .bind(when.toISOString(), sessionId)
    .run();
  // Non-ephemeral: the confirmation belongs to both partners in the thread.
  return c.json({
    type: ResponseType.CHANNEL_MESSAGE,
    data: {
      content: `📅 Locked in: ${discordTime(when)} (${formatToronto(when)} Toronto). Report forms arrive here + by DM at session time.`,
    },
  });
}

async function onEnrollmentComplete(c: Ctx, interaction: Interaction, discordUserId: string) {
  const cfg = await getSettings(c.env, ['organizer_channel_id', 'participant_role_id']);
  const p = await getParticipant(c.env, discordUserId);
  if (interaction.guild_id && cfg.participant_role_id) {
    await enqueue(c.env, 'role_add', {
      guildId: interaction.guild_id,
      userId: discordUserId,
      roleId: cfg.participant_role_id,
    });
  }
  if (cfg.organizer_channel_id) {
    const count = await c.env.DB.prepare(
      "SELECT count(*) AS n FROM participants WHERE topics IS NOT NULL AND status = 'active'",
    ).first<{ n: number }>();
    await enqueue(c.env, 'channel_msg', {
      channelId: cfg.organizer_channel_id,
      message: { content: `🎓 **${p?.name ?? 'Someone'}** (<@${discordUserId}>) enrolled — ${count?.n ?? '?'} total.` },
    });
  }
}

async function handleVerifySubmit(c: Ctx, interaction: Interaction, values: Map<string, string | string[]>) {
  const user = interactionUser(interaction)!;
  const name = String(values.get('name') ?? '').trim();
  const why = String(values.get('why') ?? '').trim();
  const cfg = await getSettings(c.env, ['member_role_id', 'intro_channel_id']);
  if (!interaction.guild_id || !cfg.member_role_id) {
    return c.json(ephemeral('Verification isn\'t configured yet — ping an organizer.'));
  }
  await enqueue(c.env, 'role_add', {
    guildId: interaction.guild_id,
    userId: user.id,
    roleId: cfg.member_role_id,
  });
  if (name) {
    await enqueue(c.env, 'nickname', {
      guildId: interaction.guild_id,
      userId: user.id,
      nick: name.slice(0, 32),
    });
  }
  if (cfg.intro_channel_id) {
    await enqueue(c.env, 'channel_msg', {
      channelId: cfg.intro_channel_id,
      message: {
        content: `👋 Welcome **${name || 'a new member'}** (<@${user.id}>)${why ? ` — “${why.slice(0, 200)}”` : ''}`,
        allowed_mentions: { parse: [] },
      },
    });
  }
  return c.json(
    ephemeral(
      `Welcome, ${name || 'friend'}! 🎉 Your access unlocks in a few seconds. Interested in the mock-interview program? Run \`/join\` anywhere.`,
    ),
  );
}

/** Posts (or reposts) the verification panel — called from /setup verify. */
export async function postVerifyPanel(c: Ctx, interaction: Interaction): Promise<string> {
  const cfg = await getSettings(c.env, ['start_here_channel_id', 'member_role_id']);
  if (!cfg.start_here_channel_id || !cfg.member_role_id) {
    return 'Set the start-here channel and member role first: `/setup channels` + `/setup roles`.';
  }
  await enqueue(c.env, 'channel_msg', {
    channelId: cfg.start_here_channel_id,
    message: {
      content:
        '**Welcome to Western Tech Alumni!** 👋\nTo keep bots out, click below and tell us who you are — takes 20 seconds and unlocks the server.',
      components: [buttonRow([{ id: 'verify:start', label: "Verify — I'm a real person", style: 3, emoji: '✅' }])],
    },
  });
  await setSetting(c.env, 'verify_panel_message_id', 'queued');
  return `Verification panel queued for <#${cfg.start_here_channel_id}>. Lock @everyone down to that channel once the backfill has run.`;
}
