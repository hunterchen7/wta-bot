import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCohort } from '../src/engine/weeks';
import { app } from '../src/index';
import { aiReviewSchema, extractModelText, normalizeAiReview, runPendingReviewEvaluation, transcriptResultSchema } from '../src/services/review-analysis';
import { REVIEW_OBSERVATION_VERSION, reviewV3ObservationsSchema } from '../src/services/review-observations';

let jobId = 0;
let sessionId = 0;
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
  sessionId = Number(session.meta.last_row_id);
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
    expect((await app.request('/api/analysis/worker/import/token', { method: 'POST' }, env)).status).toBe(401);
    expect((await app.request(`/api/analysis/worker/jobs/${jobId}/evaluate`, { method: 'POST' }, env)).status).toBe(401);
  });

  it('mints a short-lived recording upload URL for a round-three interviewee form', async () => {
    const response = await workerRequest('/api/analysis/worker/import/token', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ uploadBaseUrl: string; expiresAt: string }>();
    expect(body.uploadBaseUrl).toMatch(/^http:\/\/localhost\/api\/forms\/ri:\d+\.\d+\.[A-Za-z0-9_-]+\/recording$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const form = await app.request(body.uploadBaseUrl.replace(/\/recording$/, ''), {}, env);
    expect(form.status).toBe(404);

    const upload = await app.request(`${body.uploadBaseUrl}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'import.mp4', size: 23, contentType: 'video/mp4' }),
    }, env);
    expect(upload.status).toBe(200);
    const asset = await upload.json<{ id: number }>();
    const abort = await app.request(`${body.uploadBaseUrl}/${asset.id}`, { method: 'DELETE' }, env);
    expect(abort.status).toBe(200);
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
    rubricVersion: 'round3-review-v3',
    roleAttribution: {
      resolution: 'confirmed',
      interviewer: { participantId: 9811, name: 'Analysis Interviewer', evidence: [moment('The interviewer asks the opening question.')] },
      interviewee: { participantId: 9812, name: 'Analysis Interviewee', evidence: [moment('The interviewee explains the approach.')] },
      turns: [{ startSeconds: 0, endSeconds: 4200, role: 'interviewee', confidence: 0.8 }],
      rationale: 'Session assignments and the conversation establish the roles.',
    },
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
  it('grades raw source without old role inferences and persists observations separately from calculated fields', async () => {
    const draft = reviewDraft();
    draft.phaseTimeline = [{ phase: 'implementation', startSeconds: 0, endSeconds: 4200, summary: 'Full recorded assessment.', pacingControl: 'shared' }];
    const observations = reviewV3ObservationsSchema.parse({
      ...draft,
      observationVersion: REVIEW_OBSERVATION_VERSION,
      candidate: { dimensions: draft.candidate.dimensions, solutionOutcome: draft.candidate.solutionOutcome, rationale: draft.candidate.rationale },
      interviewer: { dimensions: draft.interviewer.dimensions, criticalFlags: [] },
    });
    const key = `test-observations/${sessionId}/transcript.json`;
    await env.RECORDINGS!.put(key, JSON.stringify({
      version: 'wta-transcript-v1', language: 'en', durationSeconds: 4200,
      transcriptConfidence: .99, speakerConfidence: .98,
      transcriptionModel: 'test-asr', diarizationModel: 'test-diarization',
      segments: [{ start: 0, end: 4200, text: 'Complete source transcript.', speaker: 'SPEAKER_00', role: 'interviewer', roleConfidence: .99 }],
    }));
    await env.DB.prepare("UPDATE review_analysis_jobs SET status = 'evaluating', transcript_object_key = ?2, lease_expires_at = NULL WHERE id = ?1").bind(jobId, key).run();
    const run = vi.fn().mockResolvedValue({ response: JSON.stringify(observations) });
    // The evaluator uses only Ai.run; the real remote binding is excluded in tests.
    const result = await runPendingReviewEvaluation({ ...env, AI: { run } as unknown as Ai }, jobId);
    expect(result).toBe('ready');
    const request = run.mock.calls[0]![1] as { messages: Array<{ content: string }> };
    const source = JSON.parse(request.messages[1]!.content.split('Timestamped transcript JSON:\n')[1]!);
    expect(source.segments[0]).toMatchObject({ speaker: 'SPEAKER_00', text: 'Complete source transcript.' });
    expect(source.segments[0]).not.toHaveProperty('role');
    expect(source.segments[0]).not.toHaveProperty('roleConfidence');
    const stored = await env.RECORDINGS!.get(`analysis/sessions/${sessionId}/jobs/${jobId}/evaluation.json`);
    const evaluation = await stored!.json<{ evaluatorObservations: unknown; evaluatorPromptVersion: string; candidate: { score: number }; confidence: { speakerAttribution: number } }>();
    expect(evaluation.evaluatorObservations).toEqual(observations);
    expect(evaluation.evaluatorPromptVersion).toBe('round3-review-v3-observations-v1');
    expect(evaluation.candidate.score).toBe(65);
    expect(evaluation.confidence.speakerAttribution).toBe(.7);
  });

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
      code: 'implementation_led',
      summary: 'The interviewer directly led the candidate implementation.',
      compromisesCandidateEvidence: true,
      evidence: [{ startSeconds: 4119, endSeconds: 4137, note: 'The interviewer disclosed the external AI use.', scope: 'interval' }],
    }];
    const review = normalizeAiReview(draft);
    expect(review.candidate.score).toBe(65);
    expect(review.candidate.scoreBand).toBe('pass');
    expect(review.candidate.readiness).toBe('manual_review');
    expect(review.candidate.manualReviewReasons).toContain('The interviewer directly led the candidate implementation.');
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

  it('represents an unusable recording as an administrative zero without fabricating ratings', () => {
    const draft = reviewDraft();
    const notObserved = { status: 'not_observed' as const, rating: null, confidence: 0, evidence: [] };
    draft.evidenceDisposition = {
      status: 'unusable',
      administrativeScore: 0,
      reason: 'The submitted recording contains no audible speech.',
    };
    draft.sessionCompletion = {
      recommendation: 'unreviewable',
      rationale: 'The recording cannot support a performance assessment.',
      evidence: [{ startSeconds: 0, endSeconds: 4200, note: 'The recording contains no audible speech.', scope: 'session' }],
    };
    draft.candidate.dimensions = {
      problemFraming: notObserved,
      reasoning: notObserved,
      implementation: notObserved,
      testingAndComplexity: notObserved,
      communication: notObserved,
      independence: notObserved,
      coachability: notObserved,
    };
    draft.candidate.solutionOutcome = 'not_observed';
    draft.interviewer.dimensions = {
      structure: notObserved,
      questionFidelity: notObserved,
      probing: notObserved,
      hintDiscipline: notObserved,
      timeManagement: notObserved,
      feedbackAndConduct: notObserved,
    };

    const review = normalizeAiReview(aiReviewSchema.parse(draft));
    expect(review.candidate.score).toBe(0);
    expect(review.candidate.readiness).toBe('manual_review');
    expect(review.candidate.manualReviewReasons).toEqual([
      'Administrative zero: The submitted recording contains no audible speech.',
    ]);
    expect(review.interviewer.score).toBeNull();
    expect(review.candidate.dimensions.reasoning).toMatchObject({ status: 'not_observed', rating: null });
  });
});

describe('role-aware review evidence', () => {
  it('preserves explicit transcript roles and defaults legacy segments to unknown', () => {
    const transcript = transcriptResultSchema.parse({
      version: 'wta-transcript-v1',
      language: 'en',
      durationSeconds: 10,
      transcriptConfidence: 0.9,
      speakerConfidence: 0.4,
      transcriptionModel: 'test',
      diarizationModel: 'test',
      segments: [
        { start: 0, end: 4, speaker: 'SPEAKER_00', role: 'interviewer', roleConfidence: 0.95, text: 'Explain your approach.' },
        { start: 4, end: 10, speaker: 'SPEAKER_00', text: 'I would use breadth-first search.' },
      ],
      vtt: 'WEBVTT\n',
    });
    expect(transcript.segments[0]).toMatchObject({ role: 'interviewer', roleConfidence: 0.95 });
    expect(transcript.segments[1]).toMatchObject({ role: 'unknown', roleConfidence: null });
  });

  it('does not accept the retired interviewer-tool-use integrity flag', () => {
    const draft = reviewDraft();
    const invalid = {
      ...draft,
      interviewer: {
        ...draft.interviewer,
        criticalFlags: [{
          code: 'external_ai_assistance',
          summary: 'The interviewer privately inspected code with a tool.',
          compromisesCandidateEvidence: true,
          evidence: [moment()],
        }],
      },
    };
    expect(() => aiReviewSchema.parse(invalid)).toThrow();
  });
});
