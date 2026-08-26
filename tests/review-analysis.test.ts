import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCohort } from '../src/engine/weeks';
import { app } from '../src/index';

let jobId = 0;
const workerId = 'test-olares-worker';
const secret = 'test-analysis-worker-secret';

const workerRequest = (path: string, init: RequestInit = {}) => app.request(path, {
  ...init,
  headers: {
    Authorization: `Bearer ${secret}`,
    'X-WTA-Worker-Id': workerId,
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...init.headers,
  },
}, { ...env, AI: undefined });

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO participants (id, discord_id, name, status)
     VALUES (9811, 'analysis-interviewer', 'Analysis Interviewer', 'active'),
            (9812, 'analysis-interviewee', 'Analysis Interviewee', 'active')`,
  ).run();
  const { weeks } = await createCohort(env, 'Analysis Cohort', [2026, 10, 1]);
  const session = await env.DB.prepare(
    `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, state, review_state)
     VALUES (?1, 9811, 9812, 'completed', 'pending')`,
  ).bind(weeks[2]!.id).run();
  const sessionId = Number(session.meta.last_row_id);
  const form = await env.DB.prepare(
    `INSERT INTO form_instances (kind, session_id, assignee_id, token_hash, deadline_at)
     VALUES ('interviewee_report', ?1, 9812, ?2, ?3)`,
  ).bind(sessionId, crypto.randomUUID(), new Date(Date.now() + 86_400_000).toISOString()).run();
  const key = `sessions/${sessionId}/analysis-test.mp4`;
  await env.RECORDINGS!.put(key, 'private recording bytes', { httpMetadata: { contentType: 'video/mp4' } });
  const asset = await env.DB.prepare(
    `INSERT INTO recording_assets
       (form_instance_id, session_id, participant_id, object_key, upload_id, status,
        original_filename, content_type, original_bytes, stored_bytes, completed_at)
     VALUES (?1, ?2, 9812, ?3, 'complete', 'uploaded', 'analysis.mp4', 'video/mp4', 23, 23, ?4)`,
  ).bind(Number(form.meta.last_row_id), sessionId, key, new Date().toISOString()).run();
  const job = await env.DB.prepare(
    `INSERT INTO review_analysis_jobs (session_id, recording_asset_id)
     VALUES (?1, ?2)`,
  ).bind(sessionId, Number(asset.meta.last_row_id)).run();
  jobId = Number(job.meta.last_row_id);
});

describe('private review analysis worker API', () => {
  it('requires the worker secret', async () => {
    expect((await app.request('/api/analysis/worker/claim', { method: 'POST' }, env)).status).toBe(401);
    expect((await app.request(`/api/analysis/worker/jobs/${jobId}/evaluate`, { method: 'POST' }, env)).status).toBe(401);
  });

  it('leases one job and streams only that recording', async () => {
    const claimed = await workerRequest('/api/analysis/worker/claim', {
      method: 'POST',
      body: JSON.stringify({ workerId }),
    });
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toMatchObject({
      job: { id: jobId, filename: 'analysis.mp4', contentType: 'video/mp4', attempt: 1 },
    });

    const media = await workerRequest(`/api/analysis/worker/jobs/${jobId}/media`);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('video/mp4');
    expect(await media.text()).toBe('private recording bytes');

    const wrongWorker = await app.request(`/api/analysis/worker/jobs/${jobId}/media`, {
      headers: { Authorization: `Bearer ${secret}`, 'X-WTA-Worker-Id': 'other-worker' },
    }, env);
    expect(wrongWorker.status).toBe(404);
  });

  it('accepts a validated transcript and leaves it ready for durable evaluation', async () => {
    const payload = {
      version: 'wta-transcript-v1',
      language: 'en',
      durationSeconds: 12.5,
      transcriptConfidence: 0.94,
      speakerConfidence: 0.82,
      transcriptionModel: 'large-v3',
      diarizationModel: 'speechbrain-ecapa',
      segments: [
        { start: 0, end: 4.2, speaker: 'SPEAKER_00', text: 'Tell me how you would approach the problem.', confidence: 0.96 },
        { start: 4.3, end: 12.5, speaker: 'SPEAKER_01', text: 'I would start by checking the constraints.', confidence: 0.92 },
      ],
      vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:04.200\nTell me how you would approach the problem.\n',
    };
    const transcriptBody = JSON.stringify(payload);
    const response = await workerRequest(`/api/analysis/worker/jobs/${jobId}/transcript`, {
      method: 'POST',
      body: transcriptBody,
      headers: { 'Content-Length': String(new TextEncoder().encode(transcriptBody).byteLength) },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, status: 'evaluating' });
    const row = await env.DB.prepare(
      `SELECT status, transcript_object_key, captions_object_key, transcript_confidence, speaker_confidence
       FROM review_analysis_jobs WHERE id = ?1`,
    ).bind(jobId).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      status: 'evaluating',
      transcript_confidence: 0.94,
      speaker_confidence: 0.82,
    });
    expect(await env.RECORDINGS!.get(String(row!.transcript_object_key))).not.toBeNull();
    expect(await env.RECORDINGS!.get(String(row!.captions_object_key))).not.toBeNull();

    const evaluation = await workerRequest(`/api/analysis/worker/jobs/${jobId}/evaluate`, { method: 'POST' });
    expect(evaluation.status).toBe(200);
    expect(await evaluation.json()).toEqual({ ok: true, status: 'none' });
  });
});
