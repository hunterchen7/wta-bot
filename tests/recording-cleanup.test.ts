import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { cleanupOrphanedRecordings } from '../src/engine/recording-cleanup';

describe('recording cleanup', () => {
  it('deletes old uploads not referenced by a submitted form', async () => {
    await env.DB.prepare(
      `INSERT INTO participants (id, discord_id, name, preferred_email, topics, status)
       VALUES (8801, 'cleanup-1', 'Cleanup One', 'cleanup1@example.com', '["dsa"]', 'active'),
              (8802, 'cleanup-2', 'Cleanup Two', 'cleanup2@example.com', '["dsa"]', 'active')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO cohorts (id, name, start_date, weeks_count, status)
       VALUES (8810, 'Cleanup Cohort', '2026-07-01', 3, 'active')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO weeks (id, cohort_id, idx, optin_opens_at, optin_closes_at, match_at, reports_due_at)
       VALUES (8811, 8810, 1, ?1, ?1, ?1, ?1)`,
    ).bind('2026-07-01T00:00:00.000Z').run();
    await env.DB.prepare(
      `INSERT INTO sessions (id, week_id, interviewer_id, interviewee_id, state)
       VALUES (8820, 8811, 8801, 8802, 'scheduled')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO form_instances (id, kind, session_id, assignee_id, token_hash, deadline_at, submitted_at, payload)
       VALUES
         (8831, 'interviewee_report', 8820, 8802, 'cleanup-unsubmitted', ?1, NULL, NULL),
         (8832, 'interviewee_report', 8820, 8802, 'cleanup-attached', ?1, ?2, '{"video_url":"https://wta.example/api/recordings/8842"}'),
         (8833, 'interviewee_report', 8820, 8802, 'cleanup-replaced', ?1, ?2, '{"video_url":"https://zoom.example/recording"}')`,
    ).bind('2026-07-10T00:00:00.000Z', '2026-07-02T00:00:00.000Z').run();

    const old = '2026-07-01T00:00:00.000Z';
    const recent = '2026-07-04T23:00:00.000Z';
    const assets = [
      { id: 8841, form: 8831, key: 'cleanup/orphan.mp4', completed: old },
      { id: 8842, form: 8832, key: 'cleanup/attached.mp4', completed: old },
      { id: 8843, form: 8833, key: 'cleanup/replaced.mp4', completed: old },
      { id: 8844, form: 8831, key: 'cleanup/recent.mp4', completed: recent },
    ];
    for (const asset of assets) {
      await env.RECORDINGS!.put(asset.key, `recording-${asset.id}`);
      await env.DB.prepare(
        `INSERT INTO recording_assets
           (id, form_instance_id, session_id, participant_id, object_key, upload_id, status, original_filename, content_type, original_bytes, stored_bytes, completed_at)
         VALUES (?1, ?2, 8820, 8802, ?3, ?4, 'uploaded', 'recording.mp4', 'video/mp4', 20, 20, ?5)`,
      ).bind(asset.id, asset.form, asset.key, `upload-${asset.id}`, asset.completed).run();
    }
    await env.DB.prepare(
      "UPDATE recording_assets SET cleanup_started_at = '2026-07-04T22:00:00.000Z' WHERE id = 8841",
    ).run();

    const result = await cleanupOrphanedRecordings(env, new Date('2026-07-05T00:00:00.000Z'));
    expect(result).toEqual({ claimed: 2, deleted: 2, failed: 0 });
    expect(await env.RECORDINGS!.get('cleanup/orphan.mp4')).toBeNull();
    expect(await env.RECORDINGS!.get('cleanup/replaced.mp4')).toBeNull();
    expect(await env.RECORDINGS!.get('cleanup/attached.mp4')).not.toBeNull();
    expect(await env.RECORDINGS!.get('cleanup/recent.mp4')).not.toBeNull();
    const { results } = await env.DB.prepare(
      'SELECT id FROM recording_assets ORDER BY id',
    ).all<{ id: number }>();
    expect(results.map((row) => row.id)).toEqual([8842, 8844]);
  });
});
