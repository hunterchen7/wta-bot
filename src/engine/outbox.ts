import type { Env } from '../env';

// Durable side-effect queue (DESIGN.md §10). Enqueue anywhere; the cron tick
// drains with a bounded subrequest budget so pairing-day fanout (hundreds of
// threads/DMs) never hits Workers' per-invocation limits. Failures retry with
// linear backoff; after MAX_ATTEMPTS the row keeps last_error for the digest.

export type OutboxKind =
  | 'dm' // { userId, message }
  | 'channel_msg' // { channelId, message }
  | 'thread_create' // { sessionId, channelId, name, starter }
  | 'role_add' // { guildId, userId, roleId }
  | 'nickname' // { guildId, userId, nick }
  | 'email' // { to, subject, text }
  | 'followup'; // { interactionToken, message } — edits a deferred response

export const MAX_ATTEMPTS = 5;

export async function enqueue(
  env: Env,
  kind: OutboxKind,
  payload: unknown,
  runAfter?: Date,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO outbox (kind, payload, run_after) VALUES (?1, ?2, ?3)`,
  )
    .bind(kind, JSON.stringify(payload), (runAfter ?? new Date()).toISOString())
    .run();
}

export async function enqueueMany(
  env: Env,
  rows: Array<{ kind: OutboxKind; payload: unknown; runAfter?: Date }>,
): Promise<void> {
  if (rows.length === 0) return;
  const stmt = env.DB.prepare('INSERT INTO outbox (kind, payload, run_after) VALUES (?1, ?2, ?3)');
  await env.DB.batch(
    rows.map((r) =>
      stmt.bind(r.kind, JSON.stringify(r.payload), (r.runAfter ?? new Date()).toISOString()),
    ),
  );
}

export type OutboxRow = {
  id: number;
  kind: OutboxKind;
  payload: string;
  attempts: number;
};

export type OutboxExecutor = (env: Env, kind: OutboxKind, payload: any) => Promise<void>;

/** Drain up to `budget` pending rows. Returns how many were attempted. */
export async function drainOutbox(
  env: Env,
  execute: OutboxExecutor,
  budget: number,
  now = new Date(),
): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, kind, payload, attempts FROM outbox
     WHERE done_at IS NULL AND attempts < ?1 AND run_after <= ?2
     ORDER BY id LIMIT ?3`,
  )
    .bind(MAX_ATTEMPTS, now.toISOString(), budget)
    .all<OutboxRow>();

  for (const row of results) {
    try {
      await execute(env, row.kind, JSON.parse(row.payload));
      await env.DB.prepare('UPDATE outbox SET done_at = ?2 WHERE id = ?1')
        .bind(row.id, now.toISOString())
        .run();
    } catch (err) {
      const attempts = row.attempts + 1;
      // Backoff computed in JS so run_after stays ISO-formatted — SQLite's
      // datetime() format ("YYYY-MM-DD hh:mm:ss") doesn't sort against ISO.
      const runAfter = new Date(now.getTime() + attempts * 5 * 60_000).toISOString();
      await env.DB.prepare(
        `UPDATE outbox SET attempts = ?2, last_error = ?3, run_after = ?4 WHERE id = ?1`,
      )
        .bind(row.id, attempts, String(err).slice(0, 500), runAfter)
        .run();
    }
  }
  return results.length;
}

/** Rows that exhausted retries — surfaced in the weekly digest. */
export async function deadLetters(env: Env, limit = 10) {
  const { results } = await env.DB.prepare(
    `SELECT id, kind, last_error FROM outbox
     WHERE done_at IS NULL AND attempts >= ?1 ORDER BY id DESC LIMIT ?2`,
  )
    .bind(MAX_ATTEMPTS, limit)
    .all<{ id: number; kind: string; last_error: string }>();
  return results;
}
