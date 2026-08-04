import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCohort } from '../src/engine/weeks';
import { signFormToken } from '../src/forms/token';
import { activeFields, fieldsFor, isNoShow, validate } from '../src/forms/schema';
import { app } from '../src/index';

// The no-show path: when the partner-attendance gate is "no", the interview
// never happened, so the report collapses to the gate + one optional note.
// No rating fields are required, collected, or stored — so a no-show can never
// count as feedback in the stats.

describe('no-show gate (pure schema logic)', () => {
  const fields = fieldsFor('interviewee_report')!;

  it('puts the partner-attendance gate first and hides the note by default', () => {
    expect(fields[0]!.id).toBe('attendance_partner');
    const normal = activeFields(fields, { attendance_partner: 'yes' }).map((f) => f.id);
    expect(normal).toContain('rating_experience');
    expect(normal).not.toContain('no_show_note');
  });

  it('collapses to gate + optional note when the partner did not show', () => {
    expect(isNoShow({ attendance_partner: 'no' })).toBe(true);
    const ids = activeFields(fields, { attendance_partner: 'no' }).map((f) => f.id);
    expect(ids).toEqual(['attendance_partner', 'no_show_note']);
  });

  it('treats "yes, but late" as a real interview (full form)', () => {
    expect(isNoShow({ attendance_partner: 'late' })).toBe(false);
    expect(activeFields(fields, { attendance_partner: 'late' }).map((f) => f.id)).toContain('rating_experience');
  });

  it('validates a no-show submission with no feedback fields', () => {
    const active = activeFields(fields, { attendance_partner: 'no' });
    const result = validate(active, { attendance_partner: 'no', no_show_note: 'waited 15 minutes' });
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ attendance_partner: 'no', no_show_note: 'waited 15 minutes' });
    // The note is optional: an empty one still passes.
    expect(validate(active, { attendance_partner: 'no' }).ok).toBe(true);
  });
});

const post = (token: string, fields: Record<string, string>) =>
  app.request(
    `/api/forms/${token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) },
    env,
  );

let intervieweeToken: string;
let sessionId: number;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO participants (discord_id, discord_username, discord_nickname, name, preferred_email, topics, status)
     VALUES ('901', 'noshow.iv', 'Iv', 'Iv Interviewer', 'iv901@example.com', '["dsa"]', 'active'),
            ('902', 'noshow.ee', 'Ee', 'Ee Interviewee', 'ee902@example.com', '["dsa"]', 'active')`,
  ).run();
  const { weeks } = await createCohort(env, 'No-Show Test', [2026, 9, 14]);
  const week = weeks[0]!;
  const ins = await env.DB.prepare(
    `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, thread_id, state, scheduled_at)
     VALUES (?1, 1, 2, 'noshow-thread', 'scheduled', '2026-09-30T23:00:00.000Z')`,
  ).bind(week.id).run();
  sessionId = Number(ins.meta.last_row_id);
  const r = await env.DB.prepare(
    `INSERT INTO form_instances (kind, session_id, assignee_id, token_hash, deadline_at)
     VALUES ('interviewee_report', ?1, 2, ?2, ?3)`,
  ).bind(sessionId, crypto.randomUUID(), week.grace_until).run();
  intervieweeToken = await signFormToken(env.FORM_SIGNING_SECRET!, Number(r.meta.last_row_id), new Date(Date.now() + 86400_000));
});

describe('no-show submission (form rail)', () => {
  it('accepts a no-show with no ratings and drops any hidden feedback values', async () => {
    // A malicious/stale client also sends rating_experience; the server must
    // strip it because it is not on the active no-show path.
    const res = await post(intervieweeToken, {
      attendance_partner: 'no',
      no_show_note: 'waited 15 minutes, no response',
      rating_experience: '5',
      confirmation: 'yes',
    });
    expect(res.status).toBe(200);
    expect(await res.json<any>()).toMatchObject({ ok: true });

    const row = await env.DB.prepare(
      "SELECT payload FROM form_instances WHERE kind = 'interviewee_report'",
    ).first<{ payload: string }>();
    const payload = JSON.parse(row!.payload);
    expect(payload.attendance_partner).toBe('no');
    expect(payload.no_show_note).toBe('waited 15 minutes, no response');
    expect(payload).not.toHaveProperty('rating_experience');
    expect(payload).not.toHaveProperty('confirmation');

    // The existing attendance cross-check still flags the session downstream.
    const s = await env.DB.prepare('SELECT state FROM sessions WHERE id = ?1').bind(sessionId).first<any>();
    expect(s.state).toBe('broken');
  });
});
