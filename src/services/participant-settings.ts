import type { Env } from '../env';
import { BLURB_MIN_WORDS, EXPERIENCE, OPPORTUNITIES, PROGRAMS, TOPICS, YEARS, wordCount } from '../intake';
import { enqueue } from '../engine/outbox';

export type ParticipantSettingsInput = {
  name: string;
  preferredEmail: string;
  westernEmail: string;
  year: string;
  program: string;
  experience: string;
  opportunities: string[];
  topics: string[];
  priorWta: boolean;
  emailOk: boolean;
  blurb: string;
  interests: string;
  priorFeedback: string;
};

export type ParticipantSettingsResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; code: 'invalid' | 'not_found' | 'duplicate_email'; message: string; fieldErrors?: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateParticipantSettings(
  env: Env,
  participantId: number,
  raw: ParticipantSettingsInput,
): Promise<ParticipantSettingsResult> {
  const input = normalizeParticipantSettings(raw);
  const fieldErrors = validateParticipantSettings(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, status: 400, code: 'invalid', message: 'Check the highlighted profile fields.', fieldErrors };
  }

  const current = await env.DB.prepare(
    'SELECT discord_id, name, preferred_email, email_ok FROM participants WHERE id = ?1',
  )
    .bind(participantId)
    .first<{ discord_id: string; name: string | null; preferred_email: string | null; email_ok: number }>();
  if (!current) return { ok: false, status: 404, code: 'not_found', message: 'Participant not found.' };

  const duplicate = await env.DB.prepare(
    'SELECT id FROM participants WHERE lower(preferred_email) = ?1 AND id <> ?2 LIMIT 1',
  )
    .bind(input.preferredEmail, participantId)
    .first();
  if (duplicate) {
    return { ok: false, status: 409, code: 'duplicate_email', message: 'That preferred email belongs to another WTA profile.', fieldErrors: { preferredEmail: 'This email is already used by another WTA profile.' } };
  }

  await env.DB.prepare(
    `UPDATE participants SET name = ?1, discord_nickname = ?1, preferred_email = ?2, western_email = ?3,
       year = ?4, program = ?5, opportunities = ?6, prior_wta = ?7,
       experience_band = ?8, topics = ?9, blurb = ?10, interests = ?11,
       prior_feedback = ?12, email_ok = ?13, updated_at = datetime('now') WHERE id = ?14`,
  )
    .bind(
      input.name,
      input.preferredEmail,
      input.westernEmail,
      input.year,
      input.program,
      JSON.stringify(input.opportunities),
      input.priorWta ? 1 : 0,
      input.experience,
      JSON.stringify(input.topics),
      input.blurb,
      input.interests || null,
      input.priorFeedback || null,
      input.emailOk ? 1 : 0,
      participantId,
    )
    .run();

  if (input.name !== current.name) {
    const guildId = env.ALLOWED_GUILD_IDS?.split(',')[0]?.trim();
    if (guildId) {
      await enqueue(env, 'nickname', {
        guildId,
        userId: current.discord_id,
        nick: input.name.slice(0, 32),
      });
    }
  }
  if (
    input.emailOk &&
    (current.email_ok !== 1 || input.preferredEmail !== current.preferred_email?.toLowerCase())
  ) {
    await enqueueEmailConfirmation(env, input.preferredEmail, input.name);
  }
  return { ok: true };
}

export function normalizeParticipantSettings(input: ParticipantSettingsInput): ParticipantSettingsInput {
  return {
    ...input,
    name: String(input.name ?? '').trim(),
    preferredEmail: String(input.preferredEmail ?? '').trim().toLowerCase(),
    westernEmail: String(input.westernEmail ?? '').trim().toLowerCase(),
    year: String(input.year ?? '').trim(),
    program: String(input.program ?? '').trim(),
    experience: String(input.experience ?? '').trim(),
    opportunities: Array.isArray(input.opportunities) ? input.opportunities.map(String) : [],
    topics: Array.isArray(input.topics) ? input.topics.map(String) : [],
    blurb: String(input.blurb ?? '').trim(),
    interests: String(input.interests ?? '').trim(),
    priorFeedback: String(input.priorFeedback ?? '').trim(),
    priorWta: input.priorWta === true,
    emailOk: input.emailOk === true,
  };
}

export function validateParticipantSettings(input: ParticipantSettingsInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.name) errors.name = 'Enter your full name.';
  else if (input.name.length > 100) errors.name = 'Full name must be 100 characters or fewer.';
  if (!EMAIL_RE.test(input.preferredEmail)) errors.preferredEmail = 'Enter a valid preferred email address.';
  else if (input.preferredEmail.length > 200) errors.preferredEmail = 'Preferred email must be 200 characters or fewer.';
  if (!EMAIL_RE.test(input.westernEmail)) errors.westernEmail = 'Enter a valid Western email address.';
  else if (input.westernEmail.length > 200) errors.westernEmail = 'Western email must be 200 characters or fewer.';
  if (!YEARS.includes(input.year)) errors.year = 'Choose your incoming year.';
  if (!PROGRAMS.includes(input.program)) errors.program = 'Choose your program.';
  if (!EXPERIENCE.includes(input.experience)) errors.experience = 'Choose how many technical interviews you have completed.';
  if (input.opportunities.length === 0) errors.opportunities = 'Choose at least one opportunity type.';
  else if (!input.opportunities.every((value) => OPPORTUNITIES.some((choice) => choice.value === value))) errors.opportunities = 'One of the selected opportunity types is invalid.';
  if (input.topics.length === 0) errors.topics = 'Choose at least one topic.';
  else if (!input.topics.every((value) => TOPICS.some((choice) => choice.value === value))) errors.topics = 'One of the selected topics is invalid.';
  const blurbWords = wordCount(input.blurb);
  if (blurbWords < BLURB_MIN_WORDS) errors.blurb = `Dream company and role response must be at least ${BLURB_MIN_WORDS} words (currently ${blurbWords}).`;
  else if (input.blurb.length > 2000) errors.blurb = 'Dream company and role response must be 2,000 characters or fewer.';
  if (input.interests.length > 1000) errors.interests = 'Learning interests must be 1,000 characters or fewer.';
  if (input.priorFeedback.length > 1000) errors.priorFeedback = 'Prior feedback must be 1,000 characters or fewer.';
  return errors;
}

export async function enqueueEmailConfirmation(env: Env, to: string, name: string) {
  await enqueue(env, 'email', {
    to,
    subject: "You're subscribed to WTA email reminders ✅",
    text:
      `Hi ${name},\n\n` +
      `This confirms you've opted into Western Tech Alumni email reminders — pairings, deadlines, and important program updates will land here alongside Discord.\n\n` +
      `You can change this any time from your WTA dashboard settings.\n\n— Western Tech Alumni`,
  });
}
