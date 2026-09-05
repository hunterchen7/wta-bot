import type { Env } from '../env';

type AuditBatch = { id: string; rubric_version: string; evaluator_model: string; reasoning_effort: string; service_tier: string };
type AuditRun = {
  id: string; job_id: number; status: string; evaluation_object_key: string | null;
  transcript_object_key: string | null; completed_at: string | null;
};

export async function activeReviewAudit(env: Env, sessionId: number) {
  const batch = await env.DB.prepare(
    `SELECT b.id, b.rubric_version, b.evaluator_model, b.reasoning_effort, b.service_tier
     FROM review_audit_batches b JOIN weeks w ON w.cohort_id = b.cohort_id AND w.idx = b.round
     JOIN sessions s ON s.week_id = w.id WHERE s.id = ?1 AND b.is_active = 1`,
  ).bind(sessionId).first<AuditBatch>();
  if (!batch) return null;
  const run = await env.DB.prepare(
    `SELECT id, job_id, status, evaluation_object_key, transcript_object_key, completed_at
     FROM review_evaluation_runs WHERE batch_id = ?1 AND session_id = ?2 ORDER BY job_id DESC, attempt DESC LIMIT 1`,
  ).bind(batch.id, sessionId).first<AuditRun>();
  // An active batch is authoritative. Missing members must not fall back to v3.
  return { batch, run };
}

/** Organizer cutover or rollback: D1 executes the two updates transactionally. */
export async function activateReviewAuditBatch(env: Env, batchId: string): Promise<void> {
  const target = await env.DB.prepare(
    `SELECT cohort_id, round FROM review_audit_batches WHERE id = ?1 AND status = 'verified'`,
  ).bind(batchId).first<{ cohort_id: number; round: number }>();
  if (!target) throw new Error('Only a fully verified audit batch can be activated.');
  await env.DB.batch([
    env.DB.prepare('UPDATE review_audit_batches SET is_active = 0 WHERE cohort_id = ?1 AND round = ?2 AND is_active = 1')
      .bind(target.cohort_id, target.round),
    env.DB.prepare("UPDATE review_audit_batches SET is_active = 1, activated_at = datetime('now') WHERE id = ?1 AND status = 'verified'")
      .bind(batchId),
  ]);
}
