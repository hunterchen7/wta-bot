import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCohort } from '../src/engine/weeks';
import { activateReviewAuditBatch, activeReviewAudit } from '../src/services/review-audits';
import { reviewAnalysisForSession } from '../src/services/review-analysis';

let cohortId: number;
const sessions: number[] = [];
const jobs: number[] = [];
beforeAll(async () => {
  await env.DB.prepare("INSERT INTO participants (id, discord_id, name, status) VALUES (9821, 'audit-interviewer', 'Interviewer', 'active'), (9822, 'audit-candidate', 'Candidate', 'active')").run();
  const { weeks } = await createCohort(env, 'Audit cohort', [2026, 10, 1]);
  cohortId = weeks[2]!.cohort_id;
  for (let i = 0; i < 2; i++) {
    const session = await env.DB.prepare("INSERT INTO sessions (week_id, interviewer_id, interviewee_id, state) VALUES (?1, 9821, 9822, 'completed')").bind(weeks[2]!.id).run();
    const sid = Number(session.meta.last_row_id);
    sessions.push(sid);
    const form = await env.DB.prepare("INSERT INTO form_instances (kind, session_id, assignee_id, token_hash, deadline_at) VALUES ('interviewee_report', ?1, 9822, ?2, '2026-10-01')").bind(sid, crypto.randomUUID()).run();
    const asset = await env.DB.prepare("INSERT INTO recording_assets (form_instance_id, session_id, participant_id, object_key, upload_id, status, original_filename, content_type, original_bytes) VALUES (?1, ?2, 9822, ?3, 'complete', 'uploaded', 'audit.mp4', 'video/mp4', 1)").bind(Number(form.meta.last_row_id), sid, `audit/${sid}/video`).run();
    const job = await env.DB.prepare("INSERT INTO review_analysis_jobs (session_id, recording_asset_id, status, rubric_version) VALUES (?1, ?2, 'ready', 'round3-review-v3')").bind(sid, Number(asset.meta.last_row_id)).run();
    jobs.push(Number(job.meta.last_row_id));
  }
});

function batch(id: string, inventory = jobs) {
  return env.DB.prepare(`INSERT INTO review_audit_batches (id, cohort_id, round, rubric_version, input_version, prompt_version, evaluator_model, reasoning_effort, service_tier, job_ids_json)
    VALUES (?1, ?2, 3, 'round3-review-v4', 'wta-local-review-v2', 'round3-review-v4', 'gpt-6-astra', 'max', 'default', ?3)`)
    .bind(id, cohortId, JSON.stringify(inventory)).run();
}
function run(batchId: string, index: number, attempt = 1) {
  return env.DB.prepare("INSERT INTO review_evaluation_runs (id, batch_id, job_id, session_id, attempt, input_sha256, provenance_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}')")
    .bind(`${batchId}-${index}-${attempt}`, batchId, jobs[index], sessions[index], attempt, 'a'.repeat(64)).run();
}
function ready(batchId: string, index: number, attempt = 1) {
  return env.DB.prepare("UPDATE review_evaluation_runs SET status = 'ready', primary_object_key = 'primary', verification_object_key = 'verification', evaluation_object_key = 'evaluation', completed_at = datetime('now') WHERE id = ?1")
    .bind(`${batchId}-${index}-${attempt}`).run();
}
const seal = (id: string) => env.DB.prepare("UPDATE review_audit_batches SET status = 'verified', verified_at = datetime('now') WHERE id = ?1").bind(id).run();

describe('versioned review audit storage', () => {
  it('rejects invalid inventory and immutable identity changes', async () => {
    await expect(batch('duplicate', [jobs[0]!, jobs[0]!])).rejects.toThrow('unique jobs');
    await expect(batch('missing', [999999])).rejects.toThrow('unique jobs');
    await batch('identity', [jobs[0]!]);
    await expect(env.DB.prepare("UPDATE review_audit_batches SET job_ids_json = '[]' WHERE id = 'identity'").run()).rejects.toThrow('immutable');
    await expect(run('identity', 1)).rejects.toThrow('outside');
    await run('identity', 0);
    await expect(env.DB.prepare("UPDATE review_evaluation_runs SET input_sha256 = ?1 WHERE batch_id = 'identity'").bind('b'.repeat(64)).run()).rejects.toThrow('immutable');
    await ready('identity', 0);
    await expect(env.DB.prepare("UPDATE review_evaluation_runs SET candidate_score = 99 WHERE batch_id = 'identity'").run()).rejects.toThrow('immutable');
    await expect(env.DB.prepare("DELETE FROM review_evaluation_runs WHERE batch_id = 'identity'").run()).rejects.toThrow('retained');
  });

  it('requires the latest attempt for every frozen member and preserves v3 until cutover', async () => {
    await batch('complete');
    await run('complete', 0); await ready('complete', 0);
    await expect(seal('complete')).rejects.toThrow('Every batch member');
    await run('complete', 1); await ready('complete', 1);
    await run('complete', 0, 2);
    await expect(seal('complete')).rejects.toThrow('Every batch member');
    expect((await reviewAnalysisForSession(env, sessions[0]!))?.rubricVersion).toBe('round3-review-v3');
    await expect(activateReviewAuditBatch(env, 'complete')).rejects.toThrow('fully verified');
    await ready('complete', 0, 2); await seal('complete');
    await activateReviewAuditBatch(env, 'complete');
    expect((await activeReviewAudit(env, sessions[0]!))?.run?.id).toBe('complete-0-2');
    expect((await reviewAnalysisForSession(env, sessions[0]!))?.rubricVersion).toBe('round3-review-v4');
    await expect(run('complete', 0, 3)).rejects.toThrow('sealed');
  });

  it('switches batches atomically, supports rollback, and does not mix missing members with v3', async () => {
    await batch('old', [jobs[0]!]); await run('old', 0); await ready('old', 0); await seal('old');
    await batch('new', [jobs[0]!]); await run('new', 0); await ready('new', 0); await seal('new');
    await activateReviewAuditBatch(env, 'old'); await activateReviewAuditBatch(env, 'new');
    expect((await activeReviewAudit(env, sessions[0]!))?.batch.id).toBe('new');
    await expect(activateReviewAuditBatch(env, 'does-not-exist')).rejects.toThrow();
    expect((await activeReviewAudit(env, sessions[0]!))?.batch.id).toBe('new');
    const missing = await reviewAnalysisForSession(env, sessions[1]!);
    expect(missing).toMatchObject({ status: 'queued', rubricVersion: 'round3-review-v4', evaluation: null, auditBatchId: 'new' });
    await activateReviewAuditBatch(env, 'old');
    expect((await activeReviewAudit(env, sessions[0]!))?.batch.id).toBe('old');
  });
});
