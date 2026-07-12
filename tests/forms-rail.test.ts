import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCohort } from '../src/engine/weeks';
import { signFormToken, signToken } from '../src/forms/token';
import { app } from '../src/index';

// Full form-rail flow against real D1: render, validate, submit, credit,
// relay, verdict → review queue.

let interviewerToken: string;
let intervieweeToken: string;
let sessionId: number;
let uploadedRecordingUrl: string;

const post = (token: string, fields: Record<string, string>) =>
  app.request(
    `/api/forms/${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    },
    env,
  );

const INTERVIEWEE_OK: Record<string, string> = {
  attendance_self: 'yes',
  attendance_partner: 'yes',
  camera_self: 'yes',
  camera_partner: 'yes',
  rating_experience: '5',
  rating_communication: '4',
  rating_preparedness: '5',
  duration: '20-30 minutes',
  video_url: 'https://zoom.example/rec/abc',
  code: 'def solve():\n    return 42',
  partner_feedback: 'Great hints, thanks!',
  confirmation: 'yes',
};

const INTERVIEWER_OK: Record<string, string> = {
  attendance_self: 'yes',
  attendance_partner: 'yes',
  camera_self: 'yes',
  camera_partner: 'yes',
  rating_experience: '5',
  rating_preparedness: '4',
  rating_clarifying_questions: '4',
  described_naive_solution: 'yes',
  implemented_naive_solution: 'yes',
  described_optimal_solution: 'yes',
  implemented_optimal_solution: 'yes',
  additional_solutions: 'not_applicable',
  time_complexity: 'yes',
  space_complexity: 'yes',
  additional_test_cases: 'yes',
  rating_problem_solving: '4',
  rating_communication: '4',
  rating_code_quality: '3',
  hints: 'few',
  duration: '20-30 minutes',
  verdict: 'pass',
  verdict_reason: 'Solid problem decomposition, clean code.',
  strengths: 'Communicates the plan before coding.',
  improvements: 'Test edge cases before declaring done.',
  code: 'def solve():\n    return 42',
  confirmation: 'yes',
};

beforeAll(async () => {
  // Roster + final-week session (idx 3 of 3 -> verdict feeds the review queue)
  await env.DB.prepare(
    `INSERT INTO participants (discord_id, name, preferred_email, topics, status)
     VALUES ('201', 'Ivy Interviewer', 'ivy@example.com', '["dsa"]', 'active'),
            ('202', 'Eve Interviewee', 'eve@example.com', '["dsa"]', 'active')`,
  ).run();
  const { weeks } = await createCohort(env, 'Rail Test', [2026, 9, 14]);
  const week3 = weeks[2]!;
  const ins = await env.DB.prepare(
    `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, state, scheduled_at)
     VALUES (?1, 1, 2, 'scheduled', '2026-09-30T23:00:00.000Z')`,
  )
    .bind(week3.id)
    .run();
  sessionId = Number(ins.meta.last_row_id);
  const mk = async (kind: string, assignee: number) => {
    const r = await env.DB.prepare(
      `INSERT INTO form_instances (kind, session_id, assignee_id, token_hash, deadline_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(kind, sessionId, assignee, crypto.randomUUID(), week3.grace_until)
      .run();
    return signFormToken(env.FORM_SIGNING_SECRET!, Number(r.meta.last_row_id), new Date(Date.now() + 86400_000));
  };
  interviewerToken = await mk('interviewer_report', 1);
  intervieweeToken = await mk('interviewee_report', 2);
});

describe('form rail', () => {
  it('returns the interviewee form schema with session context', async () => {
    const res = await app.request(`/api/forms/${intervieweeToken}`, {}, env);
    expect(res.status).toBe(200);
    const form = await res.json<any>();
    expect(form).toMatchObject({ round: 3, partnerName: 'Ivy Interviewer', role: 'interviewee' });
    expect(form.fields.map((field: any) => field.label)).toEqual(expect.arrayContaining([
      expect.stringContaining('Copy the code'), expect.stringContaining('session recording'),
    ]));
    expect(form.fields.map((field: any) => field.id)).not.toContain('language');
  });

  it('rejects an incomplete submission with field errors', async () => {
    const res = await post(intervieweeToken, { attendance_self: 'yes' });
    expect(res.status).toBe(400);
    expect(await res.json<any>()).toMatchObject({ error: 'invalid_report', fieldErrors: { attendance_partner: 'This field is required.' } });
  });

  it('uploads a private recording in parts and only serves it to organizers', async () => {
    const bytes = new TextEncoder().encode('small test recording');
    const initialized = await app.request(`/api/forms/${intervieweeToken}/recording/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'interview.mkv', size: bytes.byteLength, contentType: 'video/x-matroska' }),
    }, env);
    expect(initialized.status).toBe(200);
    const upload = await initialized.json<{ id: number; partSize: number }>();
    expect(upload.partSize).toBeGreaterThan(bytes.byteLength);

    const uploaded = await app.request(`/api/forms/${intervieweeToken}/recording/${upload.id}/part/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength) },
      body: bytes,
    }, env);
    expect(uploaded.status).toBe(200);
    const part = await uploaded.json<{ partNumber: number; etag: string }>();

    const completed = await app.request(`/api/forms/${intervieweeToken}/recording/${upload.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [part] }),
    }, env);
    expect(completed.status).toBe(200);
    const recording = await completed.json<{ url: string; storedBytes: number }>();
    expect(recording.storedBytes).toBe(bytes.byteLength);
    expect(recording.url).toContain(`/api/recordings/${upload.id}`);
    uploadedRecordingUrl = recording.url;

    const anonymous = await app.request(`/api/recordings/${upload.id}`, {}, env);
    expect(anonymous.status).toBe(401);
    const cookie = await signToken(env.FORM_SIGNING_SECRET!, 'sess:1:1', new Date(Date.now() + 60_000));
    const playback = await app.request(`/api/recordings/${upload.id}`, { headers: { Cookie: `wta_sess=${cookie}` } }, env);
    expect(playback.status).toBe(200);
    expect(playback.headers.get('content-type')).toBe('video/x-matroska');
    expect(new Uint8Array(await playback.arrayBuffer())).toEqual(bytes);

    const partial = await app.request(`/api/recordings/${upload.id}`, { headers: { Cookie: `wta_sess=${cookie}`, Range: 'bytes=0-4' } }, env);
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 0-4/${bytes.byteLength}`);
    expect(new TextDecoder().decode(await partial.arrayBuffer())).toBe('small');
  });

  it('accepts a full interviewee report and credits the side', async () => {
    const res = await post(intervieweeToken, { ...INTERVIEWEE_OK, video_url: uploadedRecordingUrl });
    expect(res.status).toBe(200);
    expect(await res.json<any>()).toMatchObject({ ok: true, message: 'Report submitted.' });
    const s = await env.DB.prepare('SELECT interviewee_credited, state FROM sessions WHERE id = ?1')
      .bind(sessionId)
      .first<any>();
    expect(s.interviewee_credited).toBe(1);
    expect(s.state).toBe('scheduled'); // not completed until both reports in
  });

  it('accepts the interviewer report: completes the session, relays feedback, queues W3 review', async () => {
    const res = await post(interviewerToken, INTERVIEWER_OK);
    expect(res.status).toBe(200);
    const s = await env.DB.prepare(
      'SELECT interviewer_credited, interviewee_credited, state, review_state FROM sessions WHERE id = ?1',
    )
      .bind(sessionId)
      .first<any>();
    expect(s).toMatchObject({
      interviewer_credited: 1,
      interviewee_credited: 1,
      state: 'completed',
      review_state: 'pending', // W3 pass verdict -> review queue
    });

    // Shared feedback relayed both directions via outbox DMs
    const { results: dms } = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'dm' AND payload LIKE '%Feedback from your session partner%'",
    ).all<any>();
    const targets = dms.map((d: any) => JSON.parse(d.payload).userId).sort();
    expect(targets).toEqual(['201', '202']);
    const toInterviewer = dms.map((d: any) => JSON.parse(d.payload)).find((p: any) => p.userId === '201');
    expect(toInterviewer.message.content).toContain('Great hints');
  });

  it('supports revision until the deadline (last write wins, no double side effects)', async () => {
    const res = await post(intervieweeToken, { ...INTERVIEWEE_OK, rating_experience: '3' });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT payload FROM form_instances WHERE kind = 'interviewee_report'",
    ).first<any>();
    expect(JSON.parse(row.payload).rating_experience).toBe('3');
  });

  it('404s tokens pointing at deleted/missing instances', async () => {
    const ghost = await signFormToken(env.FORM_SIGNING_SECRET!, 99999, new Date(Date.now() + 60_000));
    const res = await app.request(`/api/forms/${ghost}`, {}, env);
    expect(res.status).toBe(404);
  });
});
