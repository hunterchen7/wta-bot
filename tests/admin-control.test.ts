import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { automationRounds, removeAutomationParticipant } from '../src/services/admin-control';

const ACTOR_ID = 99501;
const REMOVED_ID = 99502;
const PARTNER_ID = 99503;
const COHORT_ID = 99510;
const ROUND_ONE_ID = 99511;
const ROUND_TWO_ID = 99512;
const ROUND_THREE_ID = 99513;
const SESSION_ID = 99520;

const aroundNow = (days: number) => new Date(Date.now() + days * 86400_000).toISOString();

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO participants (id, discord_id, name, preferred_email, status)
     VALUES (?1, 'admin-control-actor', 'Automation Organizer', 'control-actor@example.com', 'active'),
            (?2, 'admin-control-remove', 'Removed Person', 'control-remove@example.com', 'active'),
            (?3, 'admin-control-partner', 'Affected Partner', 'control-partner@example.com', 'active')`,
  ).bind(ACTOR_ID, REMOVED_ID, PARTNER_ID).run();
  await env.DB.prepare(
    `INSERT INTO cohorts (id, name, start_date, weeks_count, status)
     VALUES (?1, 'MCP control test', '2026-07-01', 3, 'active')`,
  ).bind(COHORT_ID).run();
  const insertRound = env.DB.prepare(
    `INSERT INTO weeks (id, cohort_id, idx, optin_opens_at, optin_closes_at, match_at, reports_due_at, grace_until)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)`,
  );
  await env.DB.batch([
    insertRound.bind(ROUND_ONE_ID, COHORT_ID, 1, aroundNow(-20), aroundNow(-18), aroundNow(-17), aroundNow(-1)),
    insertRound.bind(ROUND_TWO_ID, COHORT_ID, 2, aroundNow(-1), aroundNow(1), aroundNow(2), aroundNow(7)),
    insertRound.bind(ROUND_THREE_ID, COHORT_ID, 3, aroundNow(8), aroundNow(9), aroundNow(10), aroundNow(20)),
  ]);
  await env.DB.prepare(
    `INSERT INTO sessions (id, week_id, interviewer_id, interviewee_id, thread_id, state)
     VALUES (?1, ?2, ?3, ?4, 'admin-control-thread', 'pending_schedule')`,
  ).bind(SESSION_ID, ROUND_THREE_ID, REMOVED_ID, PARTNER_ID).run();
  await env.DB.prepare(
    `INSERT INTO form_instances (kind, session_id, assignee_id, token_hash, deadline_at)
     VALUES ('interviewer_report', ?1, ?2, 'admin-control-form', ?3)`,
  ).bind(SESSION_ID, REMOVED_ID, aroundNow(20)).run();
  await env.DB.prepare(
    `INSERT INTO optins (week_id, participant_id) VALUES (?1, ?2)`,
  ).bind(ROUND_THREE_ID, REMOVED_ID).run();
  await env.DB.prepare(
    `INSERT INTO repair_queue (week_id, participant_id, need, state)
     VALUES (?1, ?2, 'interviewee', 'open')`,
  ).bind(ROUND_THREE_ID, REMOVED_ID).run();
});

describe('admin automation controls', () => {
  it('defaults round reads to the current round and accepts a human round number', async () => {
    const current = await automationRounds(env);
    expect(current.selectedWeek?.idx).toBe(2);

    const selected = await automationRounds(env, undefined, 1);
    expect(selected.selectedWeek?.idx).toBe(1);
  });

  it('removes a participant through the complete lifecycle', async () => {
    const result = await removeAutomationParticipant(env, ACTOR_ID, REMOVED_ID, 'Organizer test removal');
    expect(result).toMatchObject({
      id: REMOVED_ID,
      status: 'removed',
      alreadyRemoved: false,
      cancelledSessions: 1,
      partnersQueued: 1,
    });
    expect(await env.DB.prepare('SELECT status, removed_reason FROM participants WHERE id = ?1').bind(REMOVED_ID).first()).toEqual({
      status: 'removed',
      removed_reason: 'Organizer test removal',
    });
    expect(await env.DB.prepare('SELECT state FROM sessions WHERE id = ?1').bind(SESSION_ID).first()).toEqual({ state: 'cancelled' });
    expect(await count('SELECT count(*) AS count FROM form_instances WHERE session_id = ?1', SESSION_ID)).toBe(0);
    expect(await count('SELECT count(*) AS count FROM optins WHERE participant_id = ?1', REMOVED_ID)).toBe(0);
    expect(await env.DB.prepare('SELECT state FROM repair_queue WHERE participant_id = ?1').bind(REMOVED_ID).first()).toEqual({ state: 'expired' });
    expect(await env.DB.prepare(
      "SELECT need, state FROM repair_queue WHERE participant_id = ?1 AND week_id = ?2",
    ).bind(PARTNER_ID, ROUND_THREE_ID).first()).toEqual({ need: 'interviewer', state: 'open' });
    expect(await count("SELECT count(*) AS count FROM outbox WHERE kind IN ('dm', 'channel_msg')")).toBeGreaterThanOrEqual(3);
  });
});

async function count(sql: string, ...bindings: unknown[]) {
  const row = await env.DB.prepare(sql).bind(...bindings).first<{ count: number }>();
  return Number(row?.count ?? 0);
}
