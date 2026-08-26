import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCohort } from '../src/engine/weeks';
import { app } from '../src/index';
import { aiReviewSchema, extractModelText, normalizeAiReview } from '../src/services/review-analysis';

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

describe('Workers AI response parsing', () => {
  it('accepts legacy, Responses API, and Chat Completions envelopes', () => {
    expect(extractModelText({ response: '{"legacy":true}' })).toBe('{"legacy":true}');
    expect(extractModelText({
      output: [
        { type: 'reasoning', content: [{ type: 'summary_text', text: 'not the answer' }] },
        { type: 'message', content: [{ type: 'output_text', text: '{"responses":true}' }] },
      ],
    })).toBe('{"responses":true}');
    expect(extractModelText({ choices: [{ message: { content: '{"chat":true}' } }] })).toBe('{"chat":true}');
    expect(extractModelText({ choices: [{ message: { parsed: { structured: true } } }] })).toBe('{"structured":true}');
  });

  it('rejects malformed model envelopes without guessing', () => {
    expect(() => extractModelText({ output: [{ type: 'reasoning', content: [] }] }))
      .toThrow(/Evaluator returned no text/);
  });
});

const moment = (note = 'Observed exchange') => ({ startSeconds: 60, endSeconds: 75, note, scope: 'moment' as const });
const observed = (rating: 1 | 2 | 3 | 4, evidence: Array<{
  startSeconds: number;
  endSeconds: number;
  note: string;
  scope: 'moment' | 'interval' | 'session' | 'report' | 'code';
}> = [moment()]) => ({ status: 'observed' as const, rating, confidence: 0.8, evidence });

function reviewDraft() {
  return aiReviewSchema.parse({
    rubricVersion: 'round3-review-v2',
    recap: 'A complete mock interview.',
    sessionCompletion: {
      recommendation: 'completed',
      rationale: 'Both participants completed a substantive interview.',
      evidence: [{ startSeconds: 0, endSeconds: 4200, note: 'The full session was reviewed.', scope: 'session' }],
    },
    candidate: {
      dimensions: {
        problemFraming: observed(3),
        reasoning: observed(3),
        implementation: observed(3),
        testingAndComplexity: observed(3),
        communication: observed(3),
        independence: observed(2),
        coachability: observed(4),
      },
      score: 3.05,
      readiness: 'pass',
      solutionOutcome: 'optimal_implemented_tested_and_analyzed',
      rationale: 'The candidate reached a correct solution with assistance.',
    },
    interviewer: {
      dimensions: {
        structure: observed(3),
        questionFidelity: observed(4),
        probing: observed(3),
        hintDiscipline: observed(2),
        timeManagement: observed(2, [{ startSeconds: 0, endSeconds: 4200, note: 'The session ran for 70 minutes.', scope: 'session' }]),
        feedbackAndConduct: observed(4),
      },
      score: 2.85,
      recommendation: 'effective',
      criticalFlags: [],
    },
    hints: [],
    phaseTimeline: [{ phase: 'implementation', startSeconds: 600, endSeconds: 3000, summary: 'Implementation occupied most of the session.', pacingControl: 'shared' }],
    keyMoments: [{ startSeconds: 60, endSeconds: 75, title: 'Approach', note: 'The candidate began framing the solution.' }],
    contradictions: [],
    confidence: { transcript: 0.7, speakerAttribution: 0.7, overall: 0.7 },
    organizerChecks: [],
  });
}

describe('AI review normalization', () => {
  it('recomputes scores and bands instead of trusting model-authored values', () => {
    const review = normalizeAiReview(reviewDraft());
    expect(review.candidate.score).toBe(65);
    expect(review.candidate.scoreBand).toBe('pass');
    expect(review.candidate.readiness).toBe('pass');
    expect(review.interviewer.score).toBe(61.7);
    expect(review.interviewer.recommendation).toBe('coaching_recommended');
  });

  it('separates a score band from a manual-review integrity override', () => {
    const draft = reviewDraft();
    draft.interviewer.criticalFlags = [{
      code: 'external_ai_assistance',
      summary: 'The interviewer used an external AI system to debug candidate code.',
      compromisesCandidateEvidence: true,
      evidence: [{ startSeconds: 4119, endSeconds: 4137, note: 'The interviewer disclosed the external AI use.', scope: 'interval' }],
    }];
    const review = normalizeAiReview(draft);
    expect(review.candidate.score).toBe(65);
    expect(review.candidate.scoreBand).toBe('pass');
    expect(review.candidate.readiness).toBe('manual_review');
    expect(review.candidate.manualReviewReasons).toContain('The interviewer used an external AI system to debug candidate code.');
    expect(review.interviewer.requiresOrganizerReview).toBe(true);
  });

  it('will not score time management from a single opening timestamp', () => {
    const draft = reviewDraft();
    draft.interviewer.dimensions.timeManagement.evidence = [{
      startSeconds: 3,
      endSeconds: 73,
      note: 'Only the opening setup was cited.',
      scope: 'session',
    }];
    const review = normalizeAiReview(draft);
    expect(review.interviewer.dimensions.timeManagement.status).toBe('not_observed');
    expect(review.interviewer.dimensions.timeManagement.rating).toBeNull();
    expect(review.organizerChecks).toContain('Time management was left unscored because its evidence did not cover a meaningful session interval.');
  });

  it('rejects inconsistent observed and unobserved dimension states', () => {
    const invalid = { ...reviewDraft().candidate.dimensions.reasoning, status: 'not_observed', rating: 4 };
    expect(() => aiReviewSchema.shape.candidate.shape.dimensions.shape.reasoning.parse(invalid)).toThrow();
  });
});
