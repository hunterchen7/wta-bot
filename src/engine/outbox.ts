import type { Env } from '../env';

// Durable side-effect queue (DESIGN.md §10). Enqueue anywhere; user-triggered
// POSTs drain a small batch immediately and cron is the retry/fanout backstop.
// Both paths use bounded subrequest budgets. Failures retry with linear
// backoff; after MAX_ATTEMPTS the row keeps last_error for the digest.

export type OutboxKind =
  | 'dm' // { userId, message }
  | 'channel_msg' // { channelId, message }
  | 'thread_create' // { sessionId, channelId, name, starter }
  | 'role_add' // { guildId, userId, roleId }
  | 'nickname' // { guildId, userId, nick }
  | 'discord_identity_sync' // { guildId, userId } — refresh username + server nickname
  | 'email' // { to, subject, text }
  | 'followup' // { interactionToken, message } — edits a deferred response
  | 'guild_setup' // { guildId, year, interactionToken } — annual bootstrap (private-first)
  | 'guild_publish'; // { guildId, interactionToken } — flip channels to live permissions

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

// Seconds a claimed row is "leased" — hidden from other concurrent drains
// while being processed. If the worker dies mid-send, the row reappears after
// the lease and is retried. Long enough to cover a slow send, short enough
// that a crash doesn't strand mail.
const LEASE_SECONDS = 120;

/** Drain up to `budget` pending rows. Returns how many were attempted.
 *  Safe to call concurrently (cron + one per POST): the claim is a single
 *  atomic UPDATE that leases rows forward, so no two live drains grab the same
 *  row. As with any external side-effect queue, a worker crash after the send
 *  but before done_at is committed can still result in an at-least-once retry. */
export async function drainOutbox(
  env: Env,
  execute: OutboxExecutor,
  budget: number,
  now = new Date(),
): Promise<number> {
  const leaseUntil = new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString();
  // Atomically claim a batch: the UPDATE pushes run_after into the future so a
  // simultaneous drain's WHERE (run_after <= now) excludes these rows.
  const { results } = await env.DB.prepare(
    `UPDATE outbox SET run_after = ?1
     WHERE id IN (
       SELECT id FROM outbox
       WHERE done_at IS NULL AND attempts < ?2 AND run_after <= ?3
       ORDER BY id LIMIT ?4
     )
     RETURNING id, kind, payload, attempts`,
  )
    .bind(leaseUntil, MAX_ATTEMPTS, now.toISOString(), budget)
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
