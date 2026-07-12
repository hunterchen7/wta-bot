import type { Env } from '../env';

const ORPHAN_RETENTION_MS = 48 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 25;
const CLEANUP_LEASE_MS = 60 * 60 * 1000;

type CleanupCandidate = { id: number; object_key: string };

export type RecordingCleanupResult = {
  claimed: number;
  deleted: number;
  failed: number;
};

/**
 * Deletes completed R2 uploads that have not been attached to a submitted
 * report after a safety window. Claiming in D1 first prevents a form submit
 * from attaching an object while it is being deleted from R2.
 */
export async function cleanupOrphanedRecordings(
  env: Env,
  now = new Date(),
  retentionMs = ORPHAN_RETENTION_MS,
  limit = CLEANUP_BATCH_SIZE,
): Promise<RecordingCleanupResult> {
  if (!env.RECORDINGS) return { claimed: 0, deleted: 0, failed: 0 };

  const claimedAt = now.toISOString();
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  const staleClaim = new Date(now.getTime() - CLEANUP_LEASE_MS).toISOString();
  const { results } = await env.DB.prepare(
    `UPDATE recording_assets SET cleanup_started_at = ?1
     WHERE id IN (
       SELECT ra.id FROM recording_assets ra
       WHERE ra.status = 'uploaded'
         AND (ra.cleanup_started_at IS NULL OR ra.cleanup_started_at <= ?3)
         AND ra.completed_at IS NOT NULL
         AND ra.completed_at <= ?2
         AND NOT EXISTS (
           SELECT 1 FROM form_instances f
           WHERE f.id = ra.form_instance_id
             AND f.submitted_at IS NOT NULL
             AND json_extract(f.payload, '$.video_url') LIKE '%/api/recordings/' || ra.id
         )
       ORDER BY ra.completed_at, ra.id
       LIMIT ?4
     )
     RETURNING id, object_key`,
  ).bind(claimedAt, cutoff, staleClaim, Math.max(1, limit)).all<CleanupCandidate>();

  let deleted = 0;
  let failed = 0;
  for (const asset of results) {
    try {
      await env.RECORDINGS.delete(asset.object_key);
      await env.DB.prepare(
        'DELETE FROM recording_assets WHERE id = ?1 AND cleanup_started_at = ?2',
      ).bind(asset.id, claimedAt).run();
      deleted++;
    } catch (error) {
      failed++;
      await env.DB.prepare(
        'UPDATE recording_assets SET cleanup_started_at = NULL WHERE id = ?1 AND cleanup_started_at = ?2',
      ).bind(asset.id, claimedAt).run();
      console.error(`recording cleanup failed for asset ${asset.id}:`, error);
    }
  }

  return { claimed: results.length, deleted, failed };
}
