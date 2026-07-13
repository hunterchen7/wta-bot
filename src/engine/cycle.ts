import { getSettings } from '../config';
import { buttonRow } from '../discord/components';
import type { Env } from '../env';
import { signToken } from '../forms/token';
import { matchWeek, type Demand } from '../matching';
import { discordTime } from '../time';
import { enqueue, enqueueMany } from './outbox';
import { pickProblem, reserveProblem } from './problems';
import { creditsOf, demandFor } from './progress';
import type { Cohort, Week } from './weeks';

// The weekly cycle (DESIGN §2): opt-in → match → threads → forms → nudges.
// Every function here is idempotent-by-claim (cron) or existence-checked.

type ActiveParticipant = { id: number; discord_id: string; name: string | null; email_ok: number; preferred_email: string | null };

async function activeParticipants(env: Env): Promise<ActiveParticipant[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, discord_id, name, email_ok, preferred_email FROM participants
     WHERE status = 'active' AND topics IS NOT NULL AND pairing_excluded = 0`,
  ).all<ActiveParticipant>();
  return results;
}

const displayName = (p: { name: string | null; discord_id: string }) => p.name ?? `<@${p.discord_id}>`;

export function optinButtons(weekId: number) {
  return buttonRow([
    { id: `optin:${weekId}:in`, label: "I'm in this week", style: 3 },
    { id: `optin:${weekId}:double`, label: 'In + catch-up double', style: 1 },
    { id: `optin:${weekId}:standby`, label: 'In + standby for extras', style: 2 },
    { id: `optin:${weekId}:out`, label: 'Sitting out', style: 4 },
  ]);
}

export async function openOptin(env: Env, week: Week): Promise<void> {
  const cfg = await getSettings(env, ['announce_channel_id', 'participant_role_id']);
  const mention = cfg.participant_role_id ? `<@&${cfg.participant_role_id}> ` : '';
  const content =
    `${mention}📋 **Round ${week.idx} opt-in is open!** (2 weeks, one interview each side)\n` +
    `Click below if you're doing interviews this week (one as interviewer, one as interviewee). ` +
    `Behind pace? Pick the double. Keen for extras if someone's partner flakes? Standby.\n` +
    `⏰ Closes ${discordTime(week.optin_closes_at)} — silence = sitting out (no penalty).`;

  if (cfg.announce_channel_id) {
    await enqueue(env, 'channel_msg', {
      channelId: cfg.announce_channel_id,
      message: { content, components: [optinButtons(week.id)] },
    });
  }
  const everyone = await activeParticipants(env);
  await enqueueMany(
    env,
    everyone.map((p) => ({
      kind: 'dm' as const,
      payload: {
        userId: p.discord_id,
        fallbackKind: 'optin_open',
        message: {
          content: `📋 WTA round ${week.idx} opt-in is open — closes ${discordTime(week.optin_closes_at)}.`,
          components: [optinButtons(week.id)],
        },
      },
    })),
  );
}

export async function optinReminder(env: Env, week: Week): Promise<void> {
  const everyone = await activeParticipants(env);
  const { results: responded } = await env.DB.prepare(
    'SELECT participant_id FROM optins WHERE week_id = ?1',
  )
    .bind(week.id)
    .all<{ participant_id: number }>();
  const respondedIds = new Set(responded.map((r) => r.participant_id));
  const silent = everyone.filter((p) => !respondedIds.has(p.id));

  await enqueueMany(
    env,
    silent.flatMap((p) => {
      const rows: Array<{ kind: 'dm' | 'email'; payload: unknown }> = [
        {
          kind: 'dm',
          payload: {
            userId: p.discord_id,
            fallbackKind: 'optin_remind',
            message: {
              content: `⏰ Last call: WTA round ${week.idx} opt-in closes ${discordTime(week.optin_closes_at, 'R')}. No response = sitting out.`,
              components: [optinButtons(week.id)],
            },
          },
        },
      ];
      if (p.email_ok && p.preferred_email) {
        rows.push({
          kind: 'email',
          payload: {
            to: p.preferred_email,
            subject: `WTA round ${week.idx}: opt-in closes soon`,
            text: `Opt-in for interview round ${week.idx} closes soon. Open Discord and click "I'm in" on the opt-in message if you're participating. No response means sitting out this round (no penalty).`,
          },
        });
      }
      return rows;
    }),
  );
}

export function sessionButtons(sessionId: number) {
  return buttonRow([
    { id: `sess:${sessionId}:sched`, label: 'Choose a time', style: 3 },
    { id: `sess:${sessionId}:cancel`, label: "Can't make it", style: 2 },
    { id: `sess:${sessionId}:noshow`, label: 'Report no-show', style: 4 },
  ]);
}

export async function closeAndMatch(env: Env, week: Week, cohort: Cohort): Promise<{ sessions: number; unmatched: number }> {
  const cfg = await getSettings(env, ['announce_channel_id', 'threads_channel_id', 'organizer_channel_id']);

  const { results: optins } = await env.DB.prepare(
    `SELECT o.participant_id, o.wants_double, o.standby, p.discord_id, p.name, p.email_ok, p.preferred_email
     FROM optins o JOIN participants p ON p.id = o.participant_id
     WHERE o.week_id = ?1 AND p.status = 'active' AND p.pairing_excluded = 0`,
  )
    .bind(week.id)
    .all<{ participant_id: number; wants_double: number; standby: number; discord_id: string; name: string | null; email_ok: number; preferred_email: string | null }>();

  // Demands from deficits (DESIGN §3)
  const demands: Demand[] = [];
  for (const o of optins) {
    const credits = await creditsOf(env, o.participant_id);
    const d = demandFor(week.idx, credits, o.wants_double === 1);
    if (d.interviewer > 0 || d.interviewee > 0) {
      demands.push({ participantId: o.participant_id, interviewer: d.interviewer, interviewee: d.interviewee });
    }
  }

  // Never-repeat constraint across the cohort
  const { results: prior } = await env.DB.prepare(
    `SELECT s.interviewer_id, s.interviewee_id FROM sessions s
     JOIN weeks w ON w.id = s.week_id WHERE w.cohort_id = ?1 AND s.state != 'cancelled'`,
  )
    .bind(cohort.id)
    .all<{ interviewer_id: number; interviewee_id: number }>();

  const result = matchWeek(
    demands,
    prior.map((p) => [p.interviewer_id, p.interviewee_id] as const),
  );

  const byId = new Map(optins.map((o) => [o.participant_id, o]));
  const perPerson = new Map<number, { interviews: string[]; interviewedBy: string[] }>();

  for (const edge of result.edges) {
    const ins = await env.DB.prepare(
      `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, state, origin)
       VALUES (?1, ?2, ?3, 'pending_schedule', 'match')`,
    )
      .bind(week.id, edge.interviewerId, edge.intervieweeId)
      .run();
    const sessionId = Number(ins.meta.last_row_id);
    const problem = await pickProblem(env, week.id, edge.interviewerId, edge.intervieweeId);
    if (problem) await reserveProblem(env, sessionId, problem.id);
    const interviewer = byId.get(edge.interviewerId)!;
    const interviewee = byId.get(edge.intervieweeId)!;

    if (cfg.threads_channel_id) {
      await enqueue(env, 'thread_create', {
        sessionId,
        channelId: cfg.threads_channel_id,
        name: `r${week.idx} · ${displayName(interviewer)} → ${displayName(interviewee)}`.slice(0, 100),
        starter: {
          content:
            `**Round ${week.idx} session** — <@${interviewer.discord_id}> interviews <@${interviewee.discord_id}>.\n` +
            `1️⃣ Agree on a time here, then hit **Choose a time**. You can reschedule later if plans change.\n` +
            `2️⃣ The interviewer gets their private problem packet as soon as the time is confirmed.\n` +
            `3️⃣ At the scheduled time you'll both get your report-form links here and by DM.\n` +
            `Deadline: sessions + reports due ${discordTime(week.grace_until ?? week.reports_due_at)}.`,
          components: [sessionButtons(sessionId)],
        },
      });
    }

    const a = perPerson.get(edge.interviewerId) ?? { interviews: [], interviewedBy: [] };
    a.interviews.push(displayName(interviewee));
    perPerson.set(edge.interviewerId, a);
    const b = perPerson.get(edge.intervieweeId) ?? { interviews: [], interviewedBy: [] };
    b.interviewedBy.push(displayName(interviewer));
    perPerson.set(edge.intervieweeId, b);
  }

  // Per-person pairing summary (DM + optional email)
  for (const [pid, info] of perPerson) {
    const p = byId.get(pid)!;
    const lines = [
      `🗓️ **Your round ${week.idx} pairings:**`,
      ...info.interviews.map((n) => `• You **interview** ${n}`),
      ...info.interviewedBy.map((n) => `• **${n}** interviews you`),
      `Coordinate times in your session threads. Everything due ${discordTime(week.grace_until ?? week.reports_due_at)}.`,
    ];
    await enqueue(env, 'dm', {
      userId: p.discord_id,
      fallbackKind: 'pairing',
      message: { content: lines.join('\n') },
    });
    if (p.email_ok && p.preferred_email) {
      await enqueue(env, 'email', {
        to: p.preferred_email,
        subject: `WTA round ${week.idx}: your interview pairings`,
        text:
          `Your round ${week.idx} pairings:\n` +
          info.interviews.map((n) => `- You interview ${n}\n`).join('') +
          info.interviewedBy.map((n) => `- ${n} interviews you\n`).join('') +
          `\nCoordinate times in your Discord session threads.`,
      });
    }
  }

  // Residual demand -> repair queue
  for (const u of result.unmatched) {
    // The person needs a counterpart in the OPPOSITE role of their unmet demand.
    const need = u.role === 'interviewer' ? 'interviewee' : 'interviewer';
    for (let i = 0; i < u.count; i++) {
      await env.DB.prepare(
        `INSERT INTO repair_queue (week_id, participant_id, need, state) VALUES (?1, ?2, ?3, 'open')`,
      )
        .bind(week.id, u.participantId, need)
        .run();
    }
  }

  if (cfg.announce_channel_id) {
    // Open question bank: publish the round's set with the pairings.
    const { results: bank } = await env.DB.prepare(
      `SELECT p.number, p.title, p.url FROM week_problem_sets wps
       JOIN problems p ON p.id = wps.problem_id WHERE wps.week_id = ?1 ORDER BY p.id`,
    )
      .bind(week.id)
      .all<{ number: number | null; title: string; url: string | null }>();
    const bankLines = bank.length
      ? `\n📚 **Round ${week.idx} question bank** (interviewers pick one):\n` +
        bank.map((p) => `• ${p.url ? `[${p.number ? `#${p.number} ` : ''}${p.title}](${p.url})` : `${p.number ? `#${p.number} ` : ''}${p.title}`}`).join('\n') +
        `\nAlso at ${env.PUBLIC_ORIGIN ?? 'https://wta.hunterchen.ca'}/bank`
      : '';
    await enqueue(env, 'channel_msg', {
      channelId: cfg.announce_channel_id,
      message: {
        content: `🤝 **Round ${week.idx} pairings are out** — ${result.edges.length} sessions across ${perPerson.size} participants. Check your DMs and session threads!${bankLines}`,
      },
    });
  }
  if (cfg.organizer_channel_id) {
    await enqueue(env, 'channel_msg', {
      channelId: cfg.organizer_channel_id,
      message: {
        content: `🧮 Round ${week.idx} matched: ${result.edges.length} sessions, ${result.unmatched.length} residual slot(s) → repair queue.`,
      },
    });
  }
  return { sessions: result.edges.length, unmatched: result.unmatched.length };
}

type ReminderSession = {
  id: number; interviewer_id: number; interviewee_id: number; thread_id: string | null;
  scheduled_at: string; reminder_sent_at: string | null; reports_due_at: string;
  grace_until: string | null; week_idx: number;
  interviewer_name: string | null; interviewee_name: string | null;
};

async function ensureReportLinks(env: Env, origin: string, session: ReminderSession) {
  const deadline = session.grace_until ?? session.reports_due_at;
  const secret = env.FORM_SIGNING_SECRET;
  if (!secret) return [];
  const links: Array<{ side: 'interviewer' | 'interviewee'; discordId: string; partnerName: string; url: string }> = [];
  for (const side of ['interviewer', 'interviewee'] as const) {
    const assignee = side === 'interviewer' ? session.interviewer_id : session.interviewee_id;
    const kind = `${side}_report`;
    let form = await env.DB.prepare(
      'SELECT id FROM form_instances WHERE session_id = ?1 AND kind = ?2 LIMIT 1',
    ).bind(session.id, kind).first<{ id: number }>();
    if (!form) {
      const inserted = await env.DB.prepare(
        `INSERT INTO form_instances (kind, session_id, assignee_id, token_hash, deadline_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(kind, session.id, assignee, crypto.randomUUID(), deadline).run();
      form = { id: Number(inserted.meta.last_row_id) };
    }
    const who = await env.DB.prepare('SELECT discord_id FROM participants WHERE id = ?1')
      .bind(assignee).first<{ discord_id: string }>();
    if (!who) continue;
    const token = await signToken(secret, `f:${form.id}`, new Date(new Date(deadline).getTime() + 7 * 86400_000));
    links.push({
      side,
      discordId: who.discord_id,
      partnerName: side === 'interviewer' ? session.interviewee_name ?? 'your interviewee' : session.interviewer_name ?? 'your interviewer',
      url: `${origin}/f/${token}`,
    });
  }
  return links;
}

/** One reminder on the first cron tick within 30 minutes of the session.
 *  Normally this lands 15–30 minutes ahead; the wider lower bound catches
 *  sessions that were only scheduled after their ideal reminder tick passed. */
export async function preInterviewReminderScan(env: Env, origin: string, now = new Date()): Promise<number> {
  const windowEnd = new Date(now.getTime() + 30 * 60_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.interviewer_id, s.interviewee_id, s.thread_id, s.scheduled_at, s.reminder_sent_at,
            w.reports_due_at, w.grace_until, w.idx AS week_idx,
            pi.name AS interviewer_name, pe.name AS interviewee_name
     FROM sessions s JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id
     JOIN participants pe ON pe.id = s.interviewee_id
     WHERE s.state = 'scheduled' AND s.reminder_sent_at IS NULL
       AND s.scheduled_at > ?1 AND s.scheduled_at <= ?2`,
  ).bind(now.toISOString(), windowEnd).all<ReminderSession>();

  for (const session of results) {
    const links = await ensureReportLinks(env, origin, session);
    if (links.length !== 2) continue;
    for (const link of links) {
      await enqueue(env, 'dm', {
        userId: link.discordId,
        fallbackKind: 'session_reminder',
        message: {
          content:
            `⏰ Your WTA session with **${link.partnerName}** starts ${discordTime(session.scheduled_at, 'R')} (${discordTime(session.scheduled_at)}).\n` +
            `You are the **${link.side}**. Keep your ${link.side} feedback form handy for afterward: ${link.url}`,
        },
      });
    }
    if (session.thread_id) {
      await enqueue(env, 'channel_msg', {
        channelId: session.thread_id,
        message: { content: `⏰ Session starts ${discordTime(session.scheduled_at, 'R')}. Your role-specific feedback forms were sent by DM.` },
      });
    }
    await env.DB.prepare('UPDATE sessions SET reminder_sent_at = ?2 WHERE id = ?1 AND reminder_sent_at IS NULL')
      .bind(session.id, now.toISOString()).run();
  }
  return results.length;
}

/** Sessions whose scheduled time has arrived get their two report forms. */
export async function formDropScan(env: Env, origin: string, now = new Date()): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.interviewer_id, s.interviewee_id, s.thread_id, s.scheduled_at, s.reminder_sent_at,
            w.reports_due_at, w.grace_until, w.idx AS week_idx,
            pi.name AS interviewer_name, pe.name AS interviewee_name
     FROM sessions s JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id
     JOIN participants pe ON pe.id = s.interviewee_id
     WHERE s.state = 'scheduled' AND s.scheduled_at <= ?1
       AND s.forms_released_at IS NULL`,
  )
    .bind(now.toISOString())
    .all<ReminderSession>();

  for (const s of results) {
    const links = await ensureReportLinks(env, origin, s);
    if (links.length !== 2) continue;
    if (!s.reminder_sent_at) {
      for (const link of links) {
        await enqueue(env, 'dm', {
          userId: link.discordId,
          fallbackKind: 'form_link',
          message: {
            content: `📝 Your **${link.side} report** for today's round-${s.week_idx} session: ${link.url}\nDue ${discordTime(s.grace_until ?? s.reports_due_at)} — your session credit needs it.`,
          },
        });
      }
    }
    if (s.thread_id) {
      await enqueue(env, 'channel_msg', {
        channelId: s.thread_id,
        message: {
          content: s.reminder_sent_at
            ? `🕑 Session time! Your role-specific feedback forms are in the reminder DMs above (due ${discordTime(s.grace_until ?? s.reports_due_at)}). Good luck! 🎤`
            : `🕑 Session time! Report-form links just went out by DM (due ${discordTime(s.grace_until ?? s.reports_due_at)}). Good luck! 🎤`,
        },
      });
    }
    await env.DB.prepare('UPDATE sessions SET forms_released_at = ?2 WHERE id = ?1 AND forms_released_at IS NULL')
      .bind(s.id, now.toISOString()).run();
  }
  return results.length;
}

/** Wednesday nudge for sessions still unscheduled. */
export async function scheduleNudge(env: Env, week: Week): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.thread_id, pi.discord_id AS interviewer_did, pe.discord_id AS interviewee_did
     FROM sessions s
     JOIN participants pi ON pi.id = s.interviewer_id
     JOIN participants pe ON pe.id = s.interviewee_id
     WHERE s.week_id = ?1 AND s.state = 'pending_schedule'`,
  )
    .bind(week.id)
    .all<any>();
  for (const s of results) {
    if (s.thread_id) {
      await enqueue(env, 'channel_msg', {
        channelId: s.thread_id,
        message: {
          content: `👋 <@${s.interviewer_did}> <@${s.interviewee_did}> — no confirmed time yet. Lock one in with **Choose a time**, or use *Can't make it* / *Report no-show* if it's not happening. Everything's due ${discordTime(week.grace_until ?? week.reports_due_at)}.`,
        },
      });
    }
  }
  const cfg = await getSettings(env, ['organizer_channel_id']);
  if (cfg.organizer_channel_id && results.length > 0) {
    await enqueue(env, 'channel_msg', {
      channelId: cfg.organizer_channel_id,
      message: { content: `⏳ Round ${week.idx}: ${results.length} session(s) still unscheduled after the nudge.` },
    });
  }
}

/** Form reminder ladder: T-24h nudge, then overdue. State-machine based. */
export async function deadlineSweep(env: Env, origin: string, now = new Date()): Promise<void> {
  const secret = env.FORM_SIGNING_SECRET;
  if (!secret) return;
  const soon = new Date(now.getTime() + 24 * 3600_000).toISOString();

  const { results: toNudge } = await env.DB.prepare(
    `SELECT f.id, f.kind, f.deadline_at, p.discord_id
     FROM form_instances f JOIN participants p ON p.id = f.assignee_id
     WHERE f.submitted_at IS NULL AND f.reminder_state = 'issued' AND f.deadline_at <= ?1`,
  )
    .bind(soon)
    .all<any>();
  for (const f of toNudge) {
    const token = await signToken(secret, `f:${f.id}`, new Date(new Date(f.deadline_at).getTime() + 7 * 86400_000));
    await enqueue(env, 'dm', {
      userId: f.discord_id,
      fallbackKind: 'form_nudge',
      message: { content: `⏰ Reminder: your **${f.kind.replace('_', ' ')}** is due ${discordTime(f.deadline_at, 'R')} — ${origin}/f/${token}` },
    });
    await env.DB.prepare("UPDATE form_instances SET reminder_state = 'nudged' WHERE id = ?1").bind(f.id).run();
  }

  const { results: overdue } = await env.DB.prepare(
    `SELECT f.id, f.kind, f.deadline_at, p.discord_id, p.email_ok, p.preferred_email
     FROM form_instances f JOIN participants p ON p.id = f.assignee_id
     WHERE f.submitted_at IS NULL AND f.reminder_state = 'nudged' AND f.deadline_at <= ?1`,
  )
    .bind(now.toISOString())
    .all<any>();
  for (const f of overdue) {
    const token = await signToken(secret, `f:${f.id}`, new Date(new Date(f.deadline_at).getTime() + 7 * 86400_000));
    const url = `${origin}/f/${token}`;
    await enqueue(env, 'dm', {
      userId: f.discord_id,
      fallbackKind: 'form_overdue',
      message: { content: `🔴 Your **${f.kind.replace('_', ' ')}** is now **overdue** — your session won't count until it's in: ${url}` },
    });
    if (f.email_ok && f.preferred_email) {
      await enqueue(env, 'email', {
        to: f.preferred_email,
        subject: 'WTA: your interview report is overdue',
        text: `Your ${f.kind.replace('_', ' ')} is overdue. Submit it here: ${url}\nYour session credit is on hold until it's in.`,
      });
    }
    await env.DB.prepare("UPDATE form_instances SET reminder_state = 'overdue' WHERE id = ?1").bind(f.id).run();
  }
}
