// Slash-command handlers. Routed from interactions.ts.

import type { Context } from 'hono';
import { setSetting, getSettings } from '../config';
import { ephemeral } from '../discord/components';
import { getSession, reportIncident, resolveCase } from '../engine/incidents';
import { weeklyDigest } from '../engine/digest';
import { enqueue } from '../engine/outbox';
import { creditsOf, strikesOf } from '../engine/progress';
import { activeCohort, cohortWeeks, createCohort } from '../engine/weeks';
import type { Env } from '../env';
import { signToken } from '../forms/token';
import * as intake from '../intake';
import { getParticipant, listParticipants, participantsToCsv } from '../participants';
import { discordTime } from '../time';
import { type Interaction, interactionUser, ResponseType } from '../discord/types';
import { postVerifyPanel } from './components';
import { isOrganizer } from './shared';

type Ctx = Context<{ Bindings: Env }>;

type Opt = { name: string; type?: number; value?: string | number | boolean; options?: Opt[] };
const sub = (i: Interaction): Opt | undefined => (i.data?.options as Opt[] | undefined)?.[0];
const optVal = (opts: Opt[] | undefined, name: string) => opts?.find((o) => o.name === name)?.value;

export async function handleCommand(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction);
  if (!user) return c.json(ephemeral('Could not identify you — try again.'));

  switch (interaction.data?.name) {
    case 'help': {
      const lines = [
        '**WTA bot — commands**',
        '`/join` — enroll in the program, or edit your profile once enrolled',
        '`/status` — your progress (3+3), sessions, owed report forms, strikes',
        '`/optout` — sit out the current round (no penalty; catch up later with a double)',
        '`/leave` — leave the program entirely (confirmable; partners get re-paired)',
        '`/cancel` — cancel one of your sessions with notice, so your partner gets re-paired',
        '`/report no-show` / `/report unresponsive` — your partner ghosted or won\'t schedule',
        '`/report issue <details>` — anything else, privately to the organizers',
        '`/dashboard` — one-click sign-in link for the web dashboard',
        '',
        '**Buttons you\'ll meet:** round opt-in (I\'m in / double / standby / out) · session threads (Scheduled ✅ / Can\'t make it / Report no-show) · Verify (in #start-here)',
        `**Web dashboard:** log in with your roster email at ${c.env.PUBLIC_ORIGIN ?? 'the bot site'}/login — progress, sessions, and your report forms in one place.`,
      ];
      if (await isOrganizer(c.env, interaction)) {
        lines.push(
          '',
          '**Organizer toolkit — everything lives under `/admin`:**',
          '`/admin setup channels|roles|cohort|verify` — configure + launch',
          '`/admin roster` · `/admin export` · `/admin standing @user` — who\'s where',
          '`/admin pair` · `/admin repair` — manual pairings and repair queueing',
          '`/admin excuse @user` · `/admin participant hold|release|remove @user`',
          '`/admin problems add|list|setweek` · `/admin digest` · `/admin eligible` · `/admin backfill`',
          'Dashboard organizer pages: Roster, Round board, Reviews, Problems (`/dashboard` for a sign-in link).',
        );
      }
      return c.json(ephemeral(lines.join('\n')));
    }

    case 'join': {
      const existing = await getParticipant(c.env, user.id);
      if (existing?.status === 'removed') {
        if ((existing as any).removed_reason === 'withdrew') {
          const { buttonRow } = await import('../discord/components');
          return c.json(
            ephemeral(
              '👋 **Welcome back?** You left the program earlier — rejoining restores everything as it was: your profile, your completed interviews, your history. If you\'re behind pace, the next opt-in will offer you a catch-up double.',
              [buttonRow([{ id: 'rejoin:confirm', label: 'Rejoin the program', style: 3 }])],
            ),
          );
        }
        return c.json(
          ephemeral('You were removed from this cohort. Talk to an organizer if you think that\'s a mistake.'),
        );
      }
      // Resume where they left off; enrolled users get the edit menu.
      if (!existing || !existing.name) return c.json(intake.modal1(existing));
      if (existing.year === null) return c.json(intake.modal2(existing));
      if (existing.topics === null) return c.json(intake.modal3(existing));
      return c.json(intake.profileMenu(existing));
    }

    case 'status':
      return statusCommand(c, interaction);

    case 'optout':
      return optoutCommand(c, interaction);

    case 'leave': {
      const p = await getParticipant(c.env, user.id);
      if (!p || p.topics === null) return c.json(ephemeral("You're not enrolled, so nothing to leave."));
      if (p.status === 'removed') return c.json(ephemeral("You've already left the program."));
      const { buttonRow } = await import('../discord/components');
      return c.json(
        ephemeral(
          '⚠️ **Leave WTA for good?** Your open sessions get cancelled (partners are automatically re-paired), you won\'t be matched again, and re-entry needs an organizer. Completed history is kept. If you just need a break, `/optout` skips one round instead.',
          [
            buttonRow([
              { id: 'leave:confirm', label: 'Yes — leave the program', style: 4 },
              { id: 'leave:cancel', label: 'Never mind', style: 2 },
            ]),
          ],
        ),
      );
    }

    case 'cancel':
    case 'report':
      return reportCommand(c, interaction);

    case 'dashboard':
      return dashboardCommand(c, interaction);

    case 'admin':
      return adminCommand(c, interaction);

    default:
      return c.json(ephemeral('Unknown command.'));
  }
}

// --------------------------------------------------------------------------

async function dashboardCommand(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction)!;
  const p = await getParticipant(c.env, user.id);
  if (!p) return c.json(ephemeral('Enroll first with `/join`, then I can sign you in.'));
  const secret = c.env.FORM_SIGNING_SECRET;
  if (!secret) return c.json(ephemeral('Dashboard not configured.'));
  const organizer = await isOrganizer(c.env, interaction);
  const token = await signToken(secret, `magic:${p.id}:${organizer ? 1 : 0}`, new Date(Date.now() + 10 * 60_000));
  const origin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin;
  return c.json(
    ephemeral(
      `🔐 Your personal sign-in link (valid 10 minutes, only visible to you):\n${origin}/auth/${token}\n` +
        (organizer ? 'You\'ll land with organizer access.' : 'You\'ll land on your progress page.'),
    ),
  );
}

const ADMIN_GROUPS = new Set(['setup', 'participant', 'problems']);

async function adminCommand(c: Ctx, interaction: Interaction) {
  if (!(await isOrganizer(c.env, interaction))) return c.json(ephemeral('Organizers only.'));
  const level1 = (interaction.data?.options as Opt[] | undefined)?.[0];
  if (!level1) return c.json(ephemeral('Pick a subcommand.'));
  const group = ADMIN_GROUPS.has(level1.name) ? level1.name : null;
  const s = group ? level1.options?.[0] : level1;
  if (!s) return c.json(ephemeral('Pick a subcommand.'));

  if (group === 'setup') return setupCommand(c, interaction, s);
  if (group === 'participant') return participantCommand(c, interaction, s);
  if (group === 'problems') return problemsCommand(c, interaction, s);

  switch (s.name) {
    case 'roster':
      return rosterCommand(c, interaction);
    case 'export': {
      const secret = c.env.FORM_SIGNING_SECRET;
      if (!secret) return c.json(ephemeral('Form rail not configured (FORM_SIGNING_SECRET).'));
      const token = await signToken(secret, 'export:participants', new Date(Date.now() + 10 * 60_000));
      const origin = new URL(c.req.url).origin;
      return c.json(ephemeral(`Roster CSV (link valid 10 minutes):\n${origin}/export/${token}`));
    }
    case 'digest': {
      const cohort = await activeCohort(c.env);
      if (!cohort) return c.json(ephemeral('No active cohort.'));
      const weeks = await cohortWeeks(c.env, cohort.id);
      const now = Date.now();
      const current =
        [...weeks].reverse().find((w) => now >= new Date(w.optin_opens_at).getTime()) ?? weeks[0]!;
      await weeklyDigest(c.env, current);
      return c.json(ephemeral(`Digest for round ${current.idx} queued to the organizer channel.`));
    }
    case 'eligible': {
      const { results } = await c.env.DB.prepare(
        "SELECT name, discord_id FROM participants WHERE status = 'completed' ORDER BY id",
      ).all<{ name: string | null; discord_id: string }>();
      return c.json(
        ephemeral(
          results.length
            ? `🏆 **Alumni-round eligible (${results.length}):**\n${results.map((r) => `• ${r.name ?? '?'} (<@${r.discord_id}>)`).join('\n')}`
            : 'Nobody eligible yet — 6/6 credits + verified final-round pass required.',
        ),
      );
    }
    case 'backfill': {
      const { getSettings: gs } = await import('../config');
      const { member_role_id } = await gs(c.env, ['member_role_id']);
      if (!interaction.guild_id || !member_role_id) {
        return c.json(ephemeral('Set the member role first (`/admin setup roles`).'));
      }
      await enqueue(c.env, 'backfill', {
        guildId: interaction.guild_id,
        roleId: member_role_id,
        interactionToken: interaction.token,
      });
      return c.json({ type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: 64 } });
    }
    case 'standing':
      return standingCommand(c, interaction, s.options);
    case 'excuse':
      return excuseCommand(c, interaction, s.options);
    case 'pair':
      return pairCommand(c, interaction, s.options);
    case 'repair':
      return repairCommand(c, interaction, s.options);
    default:
      return c.json(ephemeral('Unknown admin subcommand.'));
  }
}

async function statusCommand(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction)!;
  const p = await getParticipant(c.env, user.id);
  if (!p) return c.json(ephemeral("You're not enrolled yet — run `/join` to sign up."));
  if (p.topics === null) {
    return c.json(ephemeral('Your sign-up is incomplete — run `/join` to finish the remaining steps.'));
  }

  const credits = await creditsOf(c.env, p.id);
  const strikes = await strikesOf(c.env, p.id);
  const lines = [
    `**${p.name ?? user.username}** — ${p.status === 'active' ? '🟢 active' : `⚠️ ${p.status}`}`,
    `Progress: 🎙️ interviewer **${credits.interviewer}/3** · 🧑‍💻 interviewee **${credits.interviewee}/3**`,
  ];

  const cohort = await activeCohort(c.env);
  if (cohort) {
    const { results: sessions } = await c.env.DB.prepare(
      `SELECT s.id, s.state, s.scheduled_at, s.thread_id, w.idx,
              s.interviewer_id, s.interviewee_id,
              pi.name AS interviewer_name, pe.name AS interviewee_name
       FROM sessions s
       JOIN weeks w ON w.id = s.week_id AND w.cohort_id = ?1
       JOIN participants pi ON pi.id = s.interviewer_id
       JOIN participants pe ON pe.id = s.interviewee_id
       WHERE (s.interviewer_id = ?2 OR s.interviewee_id = ?2)
         AND s.state IN ('pending_schedule', 'scheduled')
       ORDER BY w.idx, s.id`,
    )
      .bind(cohort.id, p.id)
      .all<any>();
    if (sessions.length) {
      lines.push('**Open sessions:**');
      for (const s of sessions) {
        const role = s.interviewer_id === p.id ? `you interview ${s.interviewee_name ?? '?'}` : `${s.interviewer_name ?? '?'} interviews you`;
        const when = s.scheduled_at ? ` — ${discordTime(s.scheduled_at)}` : ' — **not scheduled yet**';
        const link = s.thread_id && interaction.guild_id ? ` → <#${s.thread_id}>` : '';
        lines.push(`• R${s.idx}: ${role}${when}${link}`);
      }
    }
  }

  const secret = c.env.FORM_SIGNING_SECRET;
  const { results: owed } = await c.env.DB.prepare(
    `SELECT id, kind, deadline_at FROM form_instances
     WHERE assignee_id = ?1 AND submitted_at IS NULL ORDER BY deadline_at`,
  )
    .bind(p.id)
    .all<any>();
  if (owed.length && secret) {
    const origin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin;
    lines.push('**Reports you owe:**');
    for (const f of owed) {
      const token = await signToken(c.env.FORM_SIGNING_SECRET!, `f:${f.id}`, new Date(new Date(f.deadline_at).getTime() + 7 * 86400_000));
      lines.push(`• ${f.kind.replace('_', ' ')} — due ${discordTime(f.deadline_at, 'R')} → ${origin}/f/${token}`);
    }
  } else {
    lines.push('No reports owed. ✅');
  }
  if (strikes > 0) lines.push(`⚠️ Confirmed no-show strikes: **${strikes}** (2 = removal review)`);

  return c.json(ephemeral(lines.join('\n')));
}

async function optoutCommand(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction)!;
  const p = await getParticipant(c.env, user.id);
  if (!p) return c.json(ephemeral("You're not enrolled — nothing to opt out of."));
  const now = new Date().toISOString();
  const week = await c.env.DB.prepare(
    `SELECT w.* FROM weeks w JOIN cohorts c ON c.id = w.cohort_id AND c.status = 'active'
     WHERE w.optin_opens_at <= ?1 AND w.match_at > ?1 ORDER BY w.idx LIMIT 1`,
  )
    .bind(now)
    .first<any>();
  if (!week) {
    return c.json(ephemeral('No opt-in is currently open. If you need out of an already-matched session, use `/cancel`.'));
  }
  await c.env.DB.prepare('DELETE FROM optins WHERE week_id = ?1 AND participant_id = ?2')
    .bind(week.id, p.id)
    .run();
  return c.json(ephemeral(`You're sitting out round ${week.idx} — no penalty. Catch up later with a double.`));
}

async function reportCommand(c: Ctx, interaction: Interaction) {
  const user = interactionUser(interaction)!;
  const p = await getParticipant(c.env, user.id);
  if (!p) return c.json(ephemeral("You're not on the roster — run `/join` first."));

  const isCancel = interaction.data?.name === 'cancel';
  const subcmd = isCancel ? 'cancel' : (sub(interaction)?.name ?? 'no-show');

  if (subcmd === 'issue') {
    const details = String(optVal(sub(interaction)?.options, 'details') ?? '').slice(0, 1500);
    const { organizer_channel_id } = await getSettings(c.env, ['organizer_channel_id']);
    if (organizer_channel_id) {
      await enqueue(c.env, 'channel_msg', {
        channelId: organizer_channel_id,
        message: { content: `📨 **Issue report** from <@${user.id}>:\n> ${details}` },
      });
      return c.json(ephemeral('Sent privately to the organizers. Thanks for flagging it.'));
    }
    return c.json(ephemeral('Organizer channel isn\'t configured yet — DM an organizer directly.'));
  }

  // Which session? In a session thread we can infer; otherwise pick the open one.
  const kind = subcmd === 'cancel' ? 'late_cancel' : subcmd === 'unresponsive' ? 'unresponsive' : 'ghost';
  const { results: candidates } = await c.env.DB.prepare(
    `SELECT s.* FROM sessions s JOIN weeks w ON w.id = s.week_id
     JOIN cohorts co ON co.id = w.cohort_id AND co.status = 'active'
     WHERE (s.interviewer_id = ?1 OR s.interviewee_id = ?1)
       AND s.state IN ('pending_schedule', 'scheduled')
     ORDER BY s.id DESC`,
  )
    .bind(p.id)
    .all<any>();
  if (candidates.length === 0) {
    return c.json(ephemeral('No open sessions found to report on.'));
  }
  const inThread = candidates.find((s) => s.thread_id && s.thread_id === (interaction as any).channel_id);
  const target = inThread ?? (candidates.length === 1 ? candidates[0] : null);
  if (!target) {
    const list = candidates
      .map((s: any) => `• session #${s.id} (week ${s.week_id})${s.thread_id ? ` — <#${s.thread_id}>` : ''}`)
      .join('\n');
    return c.json(
      ephemeral(`You have multiple open sessions — use the buttons in the right session thread instead:\n${list}`),
    );
  }
  const session = await getSession(c.env, target.id);
  const result = await reportIncident(c.env, session!, kind as any, user.id);
  return c.json(ephemeral(result.message));
}

async function rosterCommand(c: Ctx, interaction: Interaction) {
  if (!(await isOrganizer(c.env, interaction))) return c.json(ephemeral('Organizers only.'));
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

async function setupCommand(c: Ctx, interaction: Interaction, s: Opt) {
  const opts = s?.options;

  switch (s?.name) {
    case 'channels': {
      const mapping: Array<[string, any]> = [
        ['announce_channel_id', optVal(opts, 'announce')],
        ['organizer_channel_id', optVal(opts, 'organizer')],
        ['threads_channel_id', optVal(opts, 'threads')],
        ['start_here_channel_id', optVal(opts, 'start_here')],
        ['intro_channel_id', optVal(opts, 'intros')],
      ];
      const saved: string[] = [];
      for (const [key, value] of mapping) {
        if (value) {
          await setSetting(c.env, key as any, String(value));
          saved.push(`${key} → <#${value}>`);
        }
      }
      return c.json(ephemeral(saved.length ? `Saved:\n${saved.join('\n')}` : 'Nothing provided — pass at least one channel.'));
    }
    case 'roles': {
      const mapping: Array<[string, any]> = [
        ['member_role_id', optVal(opts, 'member')],
        ['participant_role_id', optVal(opts, 'participant')],
        ['organizer_role_id', optVal(opts, 'organizer')],
      ];
      const saved: string[] = [];
      for (const [key, value] of mapping) {
        if (value) {
          await setSetting(c.env, key as any, String(value));
          saved.push(`${key} → <@&${value}>`);
        }
      }
      return c.json(
        ephemeral(
          (saved.length ? `Saved:\n${saved.join('\n')}` : 'Nothing provided.') +
            '\n(Reminder: the bot role must sit **above** these roles, with Manage Roles + Manage Nicknames enabled.)',
        ),
      );
    }
    case 'cohort': {
      const name = String(optVal(opts, 'name') ?? 'WTA Cohort');
      const start = String(optVal(opts, 'start_date') ?? '');
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
      if (!m) return c.json(ephemeral('Give me `start_date` as `YYYY-MM-DD` (the day round 1 begins — 2026: `2026-07-26`).'));
      const tuple: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const { weeks } = await createCohort(c.env, name, tuple);
      const lines = weeks.map(
        (w) =>
          `**R${w.idx}** opt-in ${discordTime(w.optin_opens_at)} → match ${discordTime(w.match_at)} → due ${discordTime(w.grace_until ?? w.reports_due_at)}`,
      );
      return c.json(ephemeral(`🚀 Cohort **${name}** is live. The cron takes it from here:\n${lines.join('\n')}`));
    }
    case 'verify': {
      const message = await postVerifyPanel(c, interaction);
      return c.json(ephemeral(message));
    }
    case 'bootstrap': {
      if (!interaction.guild_id) return c.json(ephemeral('Run this in the server.'));
      const year = Number(optVal(s.options, 'year') ?? new Date().getFullYear());
      await enqueue(c.env, 'guild_setup', {
        guildId: interaction.guild_id,
        year,
        interactionToken: interaction.token,
      });
      return c.json({ type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: 64 } });
    }
    case 'publish': {
      if (!interaction.guild_id) return c.json(ephemeral('Run this in the server.'));
      await enqueue(c.env, 'guild_publish', {
        guildId: interaction.guild_id,
        interactionToken: interaction.token,
      });
      return c.json({ type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: 64 } });
    }
    default:
      return c.json(ephemeral('Subcommands: `channels`, `roles`, `cohort`, `verify`, `bootstrap`, `publish`.'));
  }
}


async function standingCommand(c: Ctx, interaction: Interaction, opts: Opt[] | undefined) {
  const target = String(optVal(opts, 'user') ?? '');
  const p = await c.env.DB.prepare('SELECT * FROM participants WHERE discord_id = ?1')
    .bind(target)
    .first<any>();
  if (!p) return c.json(ephemeral('Not on the roster.'));
  const credits = await creditsOf(c.env, p.id);
  const strikes = await strikesOf(c.env, p.id);
  const { results: incidents } = await c.env.DB.prepare(
    'SELECT kind, state, created_at FROM incidents WHERE accused_id = ?1 ORDER BY id DESC LIMIT 5',
  )
    .bind(p.id)
    .all<any>();
  return c.json(
    ephemeral(
      [
        `**${p.name ?? target}** (<@${target}>) — status **${p.status}**`,
        `Credits: interviewer ${credits.interviewer}/3 · interviewee ${credits.interviewee}/3 · strikes ${strikes}`,
        incidents.length
          ? `Recent incidents:\n${incidents.map((i: any) => `• ${i.kind} (${i.state}) ${String(i.created_at).slice(0, 10)}`).join('\n')}`
          : 'No incidents.',
      ].join('\n'),
    ),
  );
}

async function excuseCommand(c: Ctx, interaction: Interaction, opts: Opt[] | undefined) {
  const target = String(optVal(opts, 'user') ?? '');
  const p = await c.env.DB.prepare('SELECT id, discord_id FROM participants WHERE discord_id = ?1')
    .bind(target)
    .first<{ id: number; discord_id: string }>();
  if (!p) return c.json(ephemeral('Not on the roster.'));
  const latest = await c.env.DB.prepare(
    `SELECT id FROM incidents WHERE accused_id = ?1 AND state IN ('confirmed', 'open') ORDER BY id DESC LIMIT 1`,
  )
    .bind(p.id)
    .first<{ id: number }>();
  if (!latest) return c.json(ephemeral('No open/confirmed incidents to excuse.'));
  const message = await resolveCase(c.env, p.id, 'excuse', latest.id);
  return c.json(ephemeral(message));
}

/** The round that's currently in play (or the nearest one). */
async function currentWeek(c: Ctx): Promise<any | null> {
  const cohort = await activeCohort(c.env);
  if (!cohort) return null;
  const weeks = await cohortWeeks(c.env, cohort.id);
  const now = Date.now();
  return (
    weeks.find(
      (w) =>
        now >= new Date(w.optin_opens_at).getTime() &&
        now <= new Date(w.grace_until ?? w.reports_due_at).getTime(),
    ) ??
    weeks.find((w) => now < new Date(w.optin_opens_at).getTime()) ??
    weeks[weeks.length - 1] ??
    null
  );
}

async function pairCommand(c: Ctx, interaction: Interaction, opts: Opt[] | undefined) {
  const interviewerDiscord = String(optVal(opts, 'interviewer') ?? '');
  const intervieweeDiscord = String(optVal(opts, 'interviewee') ?? '');
  if (interviewerDiscord === intervieweeDiscord) return c.json(ephemeral('Two different people, please.'));

  const lookup = (d: string) =>
    c.env.DB.prepare("SELECT id, name, status FROM participants WHERE discord_id = ?1").bind(d).first<any>();
  const interviewer = await lookup(interviewerDiscord);
  const interviewee = await lookup(intervieweeDiscord);
  if (!interviewer || !interviewee) return c.json(ephemeral('Both people must be enrolled (`/join`).'));
  if (interviewer.status !== 'active' || interviewee.status !== 'active') {
    return c.json(ephemeral(`Both must be active (currently: ${interviewer.status} / ${interviewee.status}).`));
  }
  const week = await currentWeek(c);
  if (!week) return c.json(ephemeral('No active cohort — `/setup cohort` first.'));

  const { pairedBefore, spawnSession } = await import('../engine/repair');
  const repeat = await pairedBefore(c.env, week.id, interviewer.id, interviewee.id);
  const sessionId = await spawnSession(c.env, week.id, interviewer.id, interviewee.id, 'manual');
  return c.json(
    ephemeral(
      `✅ Session #${sessionId} created (round ${week.idx}): **${interviewer.name}** interviews **${interviewee.name}**. Thread + DMs are on their way.` +
        (repeat ? '\n⚠️ Heads-up: these two have been paired before — the matcher would never do this, but you\'re the boss.' : ''),
    ),
  );
}

async function repairCommand(c: Ctx, interaction: Interaction, opts: Opt[] | undefined) {
  const target = String(optVal(opts, 'user') ?? '');
  const need = String(optVal(opts, 'need') ?? '');
  if (need !== 'interviewer' && need !== 'interviewee') return c.json(ephemeral('Pick what they need.'));
  const p = await c.env.DB.prepare("SELECT id, name, status FROM participants WHERE discord_id = ?1")
    .bind(target)
    .first<any>();
  if (!p) return c.json(ephemeral('Not on the roster.'));
  const week = await currentWeek(c);
  if (!week) return c.json(ephemeral('No active cohort.'));
  const { enqueueRepair } = await import('../engine/repair');
  await enqueueRepair(c.env, week.id, p.id, need);
  return c.json(
    ephemeral(
      `🛠️ **${p.name}** queued: needs ${need === 'interviewer' ? 'someone to interview them' : 'someone to interview'}. The repair scan pairs them with a complementary victim or standby volunteer within ~15 minutes of one existing.`,
    ),
  );
}

async function problemsCommand(c: Ctx, interaction: Interaction, s: Opt) {
  const opts = s?.options;

  switch (s?.name) {
    case 'add': {
      const title = String(optVal(opts, 'title') ?? '').trim();
      const difficulty = String(optVal(opts, 'difficulty') ?? 'medium');
      const number = optVal(opts, 'number');
      const url = optVal(opts, 'url');
      const rank = optVal(opts, 'rank');
      if (!title) return c.json(ephemeral('Title required.'));
      await c.env.DB.prepare(
        `INSERT INTO problems (number, title, url, difficulty, difficulty_rank) VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
        .bind(number ?? null, title, url ?? null, difficulty, rank ?? null)
        .run();
      return c.json(
        ephemeral(
          `Added **${title}** (${difficulty}${rank ? `, rank ${rank}` : ''}). Statement/solution/hints are edited on the dashboard → Problems.`,
        ),
      );
    }
    case 'list': {
      const { results } = await c.env.DB.prepare(
        `SELECT difficulty, count(*) AS n FROM problems WHERE active = 1 GROUP BY difficulty`,
      ).all<{ difficulty: string; n: number }>();
      const { results: recent } = await c.env.DB.prepare(
        `SELECT number, title, difficulty, difficulty_rank FROM problems WHERE active = 1 ORDER BY id DESC LIMIT 15`,
      ).all<any>();
      return c.json(
        ephemeral(
          `**Bank:** ${results.map((r) => `${r.n} ${r.difficulty}`).join(' · ') || 'empty'}\n` +
            recent.map((p: any) => `• ${p.number ? `#${p.number} ` : ''}${p.title} (${p.difficulty}${p.difficulty_rank ? ` ${p.difficulty_rank}` : ''})`).join('\n'),
        ),
      );
    }
    case 'setweek': {
      const idx = Number(optVal(opts, 'week') ?? 0);
      const size = Number(optVal(opts, 'size') ?? 5);
      const cohort = await activeCohort(c.env);
      if (!cohort) return c.json(ephemeral('No active cohort — `/setup cohort` first.'));
      const week = await c.env.DB.prepare('SELECT * FROM weeks WHERE cohort_id = ?1 AND idx = ?2')
        .bind(cohort.id, idx)
        .first<any>();
      if (!week) return c.json(ephemeral(`No round ${idx} in the active cohort.`));
      const { generateWeekSet, WEEK_BANDS } = await import('../engine/problems');
      const { chosen } = await generateWeekSet(c.env, week.id, idx, size);
      const band = WEEK_BANDS[Math.min(idx, 3)];
      if (chosen.length === 0) {
        return c.json(ephemeral(`No eligible problems in the ${band?.[0]}–${band?.[1]} rank band — add some with \`/problems add\`.`));
      }
      return c.json(
        ephemeral(
          `Round ${idx} set (${chosen.length}${chosen.length < size ? ` of ${size} requested — bank is thin` : ''}, band ${band?.[0]}–${band?.[1]}):\n` +
            chosen.map((p) => `• ${p.title}`).join('\n') +
            `\nPublished at ${c.env.PUBLIC_ORIGIN ?? 'https://wta.hunterchen.ca'}/bank and in the round announcement — interviewers pick one and record it in their report.${idx === 3 ? ' (R3: sanity-check these — the band is tight on purpose.)' : ''}`,
        ),
      );
    }
    default:
      return c.json(ephemeral('Subcommands: `add`, `list`, `setweek`.'));
  }
}

async function participantCommand(c: Ctx, interaction: Interaction, s: Opt) {
  const target = String(optVal(s?.options, 'user') ?? '');
  const p = await c.env.DB.prepare('SELECT id, discord_id, status FROM participants WHERE discord_id = ?1')
    .bind(target)
    .first<{ id: number; discord_id: string; status: string }>();
  if (!p) return c.json(ephemeral('Not on the roster.'));
  const action = s?.name;
  const to = action === 'hold' ? 'held' : action === 'release' ? 'active' : action === 'remove' ? 'removed' : null;
  if (!to) return c.json(ephemeral('Subcommands: `hold`, `release`, `remove`.'));
  await c.env.DB.prepare('UPDATE participants SET status = ?1 WHERE id = ?2').bind(to, p.id).run();
  return c.json(ephemeral(`<@${target}> is now **${to}**.`));
}
