import { Hono } from 'hono';
import { getSettings } from '../config';
import { enqueue } from '../engine/outbox';
import { activeCohort, cohortWeeks } from '../engine/weeks';
import type { Env } from '../env';
import { verifyToken } from '../forms/token';
import { BLURB_MIN_WORDS, EXPERIENCE, OPPORTUNITIES, PROGRAMS, TOPICS, YEARS } from '../intake';
import { isWhitelistedAdmin } from '../organizers';
import { getParticipant, upsertParticipant } from '../participants';
import {
  enqueueEmailConfirmation,
  normalizeParticipantSettings,
  validateParticipantSettings,
  type ParticipantSettingsInput,
} from '../services/participant-settings';

export const publicApi = new Hono<{ Bindings: Env }>();

publicApi.get('/api/public/bank', async (c) => {
  const cohort = await activeCohort(c.env);
  if (!cohort) return c.json({ cohort: null, round: null, problems: [] });
  const weeks = await cohortWeeks(c.env, cohort.id);
  const now = Date.now();
  const current = weeks.find((week) => now >= new Date(week.optin_opens_at).getTime() && now <= new Date(week.grace_until ?? week.reports_due_at).getTime())
    ?? weeks.find((week) => now < new Date(week.optin_opens_at).getTime())
    ?? weeks.at(-1)!;
  const { results } = await c.env.DB.prepare(
    `SELECT p.number, p.title, p.url, p.difficulty FROM week_problem_sets wps
     JOIN problems p ON p.id = wps.problem_id WHERE wps.week_id = ?1 ORDER BY p.id`,
  ).bind(current.id).all<any>();
  return c.json({ cohort: { name: cohort.name }, round: current.idx, problems: results });
});

publicApi.get('/api/enrollment/:token', async (c) => {
  const identity = await enrollmentIdentity(c.env, c.req.param('token'));
  if (!identity) return c.json({ error: 'invalid_link', message: 'This enrollment link is invalid or expired.' }, 404);
  const participant = await getParticipant(c.env, identity.discordId);
  if (participant?.status === 'removed' && (participant as any).removed_reason !== 'withdrew') {
    return c.json({ error: 'removed', message: 'This profile was removed. Contact an organizer if you think this is a mistake.' }, 403);
  }
  return c.json({
    discord: { id: identity.discordId, username: participant?.discord_username ?? identity.username ?? null },
    profile: participant ? profileFromParticipant(participant) : null,
    options: enrollmentOptions,
    minimumBlurbWords: BLURB_MIN_WORDS,
  });
});

publicApi.post('/api/enrollment/:token', async (c) => {
  const identity = await enrollmentIdentity(c.env, c.req.param('token'));
  if (!identity) return c.json({ error: 'invalid_link', message: 'This enrollment link is invalid or expired.' }, 404);
  const raw = await c.req.json<ParticipantSettingsInput>().catch(() => null);
  if (!raw) return c.json({ error: 'invalid_json', message: 'The enrollment form could not be read.' }, 400);
  const input = normalizeParticipantSettings(raw);
  const fieldErrors = validateParticipantSettings(input);
  if (Object.keys(fieldErrors).length) return c.json({ error: 'invalid', message: 'Check the highlighted fields.', fieldErrors }, 400);

  const before = await getParticipant(c.env, identity.discordId);
  if (before?.status === 'removed' && (before as any).removed_reason !== 'withdrew') {
    return c.json({ error: 'removed', message: 'This profile was removed. Contact an organizer.' }, 403);
  }
  const duplicate = await c.env.DB.prepare(
    'SELECT id FROM participants WHERE lower(preferred_email) = ?1 AND discord_id <> ?2 LIMIT 1',
  ).bind(input.preferredEmail, identity.discordId).first();
  if (duplicate) return c.json({ error: 'duplicate_email', message: 'That email belongs to another WTA profile.', fieldErrors: { preferredEmail: 'Use a different email address.' } }, 409);

  await upsertParticipant(c.env, identity.discordId, {
    discord_username: identity.username,
    discord_nickname: input.name,
    name: input.name,
    preferred_email: input.preferredEmail,
    western_email: input.westernEmail,
    year: input.year,
    program: input.program,
    opportunities: JSON.stringify(input.opportunities),
    prior_wta: input.priorWta ? 1 : 0,
    experience_band: input.experience,
    topics: JSON.stringify(input.topics),
    blurb: input.blurb,
    interests: input.interests || null,
    prior_feedback: input.priorFeedback || null,
    email_ok: input.emailOk ? 1 : 0,
    status: 'active',
  });

  const organizerEmail = isWhitelistedAdmin(c.env, before?.preferred_email) || isWhitelistedAdmin(c.env, input.preferredEmail);
  if (identity.guildId && input.name !== before?.name && !organizerEmail) {
    await enqueue(c.env, 'nickname', { guildId: identity.guildId, userId: identity.discordId, nick: input.name.slice(0, 32) });
  }
  if (input.emailOk && (before?.email_ok !== 1 || before.preferred_email?.toLowerCase() !== input.preferredEmail)) {
    await enqueueEmailConfirmation(c.env, input.preferredEmail, input.name);
  }
  if (!before?.topics) await finishEnrollment(c.env, identity.guildId, identity.discordId, input.name);

  const participant = await getParticipant(c.env, identity.discordId);
  return c.json({ ok: true, created: !before?.topics, profile: participant ? profileFromParticipant(participant) : null });
});

const enrollmentOptions = { years: YEARS, programs: PROGRAMS, experience: EXPERIENCE, opportunities: OPPORTUNITIES, topics: TOPICS };

async function enrollmentIdentity(env: Env, token: string) {
  if (!env.FORM_SIGNING_SECRET) return null;
  const verified = await verifyToken(env.FORM_SIGNING_SECRET, token);
  const match = verified && /^enroll:(\d+):(\d+|0):([0-9a-f]+)$/.exec(verified.subject);
  if (!match) return null;
  const discordId = match[1]!;
  const guild = match[2]!;
  const encodedUsername = match[3]!;
  const usernameBytes = Uint8Array.from(encodedUsername.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
  return { discordId, guildId: guild === '0' ? null : guild, username: new TextDecoder().decode(usernameBytes) };
}

function profileFromParticipant(participant: any): ParticipantSettingsInput {
  const list = (value: string | null) => { try { return value ? JSON.parse(value) : []; } catch { return []; } };
  return {
    name: participant.name ?? '', preferredEmail: participant.preferred_email ?? '', westernEmail: participant.western_email ?? '',
    year: participant.year ?? '', program: participant.program ?? '', experience: participant.experience_band ?? '',
    opportunities: list(participant.opportunities), topics: list(participant.topics), priorWta: participant.prior_wta === 1,
    emailOk: participant.email_ok === 1, blurb: participant.blurb ?? '', interests: participant.interests ?? '', priorFeedback: participant.prior_feedback ?? '',
  };
}

async function finishEnrollment(env: Env, guildId: string | null, discordId: string, name: string) {
  const settings = await getSettings(env, ['organizer_channel_id', 'participant_role_id']);
  if (guildId && settings.participant_role_id) {
    await enqueue(env, 'role_add', { guildId, userId: discordId, roleId: settings.participant_role_id });
  }
  if (settings.organizer_channel_id) {
    const count = await env.DB.prepare("SELECT count(*) AS n FROM participants WHERE topics IS NOT NULL AND status = 'active'").first<{ n: number }>();
    await enqueue(env, 'channel_msg', {
      channelId: settings.organizer_channel_id,
      message: { content: `🎓 **${name}** (<@${discordId}>) enrolled through the web app — ${count?.n ?? '?'} total.` },
    });
  }
}
