import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { signToken } from '../forms/token';
import { isCurrentOrganizer } from '../organizers';
import {
  analysisMediaObject,
  claimRecordingAnalysis,
  markAnalysisFailed,
  retryReviewAnalysis,
  reviewAnalysisArtifact,
  runPendingReviewEvaluation,
  saveTranscriptResult,
  transcriptResultSchema,
} from '../services/review-analysis';
import { sessionFrom } from './web';

export const reviewAnalysisRoutes = new Hono<{ Bindings: Env }>();
type AnalysisContext = Context<{ Bindings: Env }>;

const MAX_TRANSCRIPT_REQUEST_BYTES = 8 * 1024 * 1024;
const workerRecordingImportSchema = z.object({
  sessionId: z.number().int().positive(),
}).strict();

reviewAnalysisRoutes.post('/api/analysis/worker/import/token', async (c) => {
  if (!(await workerAuthorized(c.env, c.req.header('authorization')))) return c.json({ error: 'unauthorized' }, 401);
  if (!c.env.FORM_SIGNING_SECRET) return c.json({ error: 'not_configured' }, 503);
  const input = workerRecordingImportSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'invalid_request', issues: input.error.issues.slice(0, 8) }, 400);

  const form = await c.env.DB.prepare(
    `SELECT f.id
     FROM form_instances f
     JOIN sessions s ON s.id = f.session_id
     JOIN weeks w ON w.id = s.week_id
     WHERE f.session_id = ?1 AND f.kind = 'interviewee_report' AND w.idx = 3
     ORDER BY f.id DESC LIMIT 1`,
  ).bind(input.data.sessionId).first<{ id: number }>();
  if (!form) return c.json({ error: 'not_found' }, 404);

  const expiresAt = new Date(Date.now() + 60 * 60_000);
  const token = await signToken(c.env.FORM_SIGNING_SECRET, `ri:${form.id}`, expiresAt);
  return c.json({
    uploadBaseUrl: `${new URL(c.req.url).origin}/api/forms/${token}/recording`,
    expiresAt: expiresAt.toISOString(),
  });
});

reviewAnalysisRoutes.post('/api/analysis/worker/claim', async (c) => {
  if (!(await workerAuthorized(c.env, c.req.header('authorization')))) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ workerId?: string }>().catch(() => null);
  const workerId = String(body?.workerId ?? '').trim().slice(0, 120);
  if (!workerId) return c.json({ error: 'invalid_worker' }, 400);
  const job = await claimRecordingAnalysis(c.env, workerId);
  return job ? c.json({ job }) : c.body(null, 204);
});

reviewAnalysisRoutes.get('/api/analysis/worker/jobs/:id/media', async (c) => {
  if (!(await workerAuthorized(c.env, c.req.header('authorization')))) return c.json({ error: 'unauthorized' }, 401);
  const jobId = Number(c.req.param('id'));
  const workerId = String(c.req.header('x-wta-worker-id') ?? '').trim().slice(0, 120);
  if (!Number.isInteger(jobId) || !workerId) return c.json({ error: 'invalid_request' }, 400);
  const object = await analysisMediaObject(c.env, jobId, workerId);
  if (!object) return c.json({ error: 'not_found' }, 404);
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Length': String(object.size),
    ETag: object.httpEtag,
  });
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
});

reviewAnalysisRoutes.post('/api/analysis/worker/jobs/:id/transcript', async (c) => {
  if (!(await workerAuthorized(c.env, c.req.header('authorization')))) return c.json({ error: 'unauthorized' }, 401);
  const jobId = Number(c.req.param('id'));
  const workerId = String(c.req.header('x-wta-worker-id') ?? '').trim().slice(0, 120);
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (!Number.isInteger(jobId) || !workerId || contentLength <= 0 || contentLength > MAX_TRANSCRIPT_REQUEST_BYTES) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  const parsed = transcriptResultSchema.safeParse(await c.req.json<unknown>().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_transcript', issues: parsed.error.issues.slice(0, 8) }, 400);
  const saved = await saveTranscriptResult(c.env, jobId, workerId, parsed.data);
  if (saved === 'stale') return c.json({ error: 'stale_lease' }, 409);
  try {
    c.executionCtx.waitUntil(runPendingReviewEvaluation(c.env, jobId));
  } catch {
    // Tests and direct app.request calls can lack an execution context. Cron is
    // the durable backstop for every job left in the evaluating state.
  }
  return c.json({ ok: true, status: 'evaluating' }, 202);
});

reviewAnalysisRoutes.post('/api/analysis/worker/jobs/:id/evaluate', async (c) => {
  if (!(await workerAuthorized(c.env, c.req.header('authorization')))) return c.json({ error: 'unauthorized' }, 401);
  const jobId = Number(c.req.param('id'));
  if (!Number.isInteger(jobId)) return c.json({ error: 'invalid_request' }, 400);

  // Keep the request open while Workers AI runs. `waitUntil` work is bounded
  // after the transcript response is sent, which is too short for a long
  // interview. The Olares worker waits for this response; cron remains the
  // durable backstop if either side is interrupted.
  const status = await runPendingReviewEvaluation(c.env, jobId);
  return c.json({ ok: status !== 'failed', status }, status === 'failed' ? 503 : 200);
});

reviewAnalysisRoutes.post('/api/analysis/worker/jobs/:id/fail', async (c) => {
  if (!(await workerAuthorized(c.env, c.req.header('authorization')))) return c.json({ error: 'unauthorized' }, 401);
  const jobId = Number(c.req.param('id'));
  const workerId = String(c.req.header('x-wta-worker-id') ?? '').trim().slice(0, 120);
  const body = await c.req.json<{ error?: string; retryable?: boolean }>().catch(() => null);
  if (!Number.isInteger(jobId) || !workerId || !body?.error) return c.json({ error: 'invalid_request' }, 400);
  await markAnalysisFailed(c.env, jobId, workerId, body.error, body.retryable !== false);
  return c.json({ ok: true });
});

reviewAnalysisRoutes.get('/api/admin/reviews/:id/captions', (c) => serveOrganizerArtifact(c, 'captions'));
reviewAnalysisRoutes.get('/api/admin/reviews/:id/transcript', (c) => serveOrganizerArtifact(c, 'transcript'));

reviewAnalysisRoutes.post('/api/admin/reviews/:id/analysis/retry', async (c) => {
  if (!(await organizerAuthorized(c))) return c.json({ error: 'forbidden' }, 403);
  const sessionId = Number(c.req.param('id'));
  if (!Number.isInteger(sessionId)) return c.json({ error: 'invalid_id' }, 400);
  const retried = await retryReviewAnalysis(c.env, sessionId);
  if (!retried) return c.json({ error: 'not_found', message: 'No recording analysis exists for this session.' }, 404);
  try {
    c.executionCtx.waitUntil(runPendingReviewEvaluation(c.env));
  } catch {
    // Cron will pick up an evaluation retry when no request context exists.
  }
  return c.json({ ok: true });
});

async function serveOrganizerArtifact(c: AnalysisContext, kind: 'captions' | 'transcript') {
  if (!(await organizerAuthorized(c))) return c.json({ error: 'forbidden' }, 403);
  const sessionId = Number(c.req.param('id'));
  if (!Number.isInteger(sessionId)) return c.json({ error: 'invalid_id' }, 400);
  const object = await reviewAnalysisArtifact(c.env, sessionId, kind);
  if (!object) return c.json({ error: 'not_found' }, 404);
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Length': String(object.size),
    'Content-Type': kind === 'captions' ? 'text/vtt; charset=utf-8' : 'application/json; charset=utf-8',
  });
  return new Response(object.body, { headers });
}

async function organizerAuthorized(c: AnalysisContext) {
  const session = await sessionFrom(c);
  return Boolean(session?.organizer && await isCurrentOrganizer(c.env, session.participantId));
}

async function workerAuthorized(env: Env, authorization: string | undefined): Promise<boolean> {
  if (!env.ANALYSIS_WORKER_SECRET) return false;
  const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(env.ANALYSIS_WORKER_SECRET)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}
