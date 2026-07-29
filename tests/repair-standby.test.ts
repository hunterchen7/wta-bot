import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { repairScan } from '../src/engine/repair';

describe('standby repair assignments', () => {
  it('uses each standby volunteer for at most one extra session per round', async () => {
    await env.DB.prepare(
      `INSERT INTO cohorts (id, name, status) VALUES (8101, 'Standby cap', 'active')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO weeks (id, cohort_id, idx, reports_due_at)
       VALUES (8101, 8101, 1, '2026-10-01T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO participants (id, discord_id, name, status)
       VALUES
         (8101, 'standby-volunteer', 'Standby Volunteer', 'active'),
         (8102, 'standby-victim-a', 'Victim A', 'active'),
         (8103, 'standby-victim-b', 'Victim B', 'active')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO optins (week_id, participant_id, standby)
       VALUES (8101, 8101, 1)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO repair_queue (week_id, participant_id, need, state)
       VALUES
         (8101, 8102, 'interviewer', 'open'),
         (8101, 8103, 'interviewer', 'open')`,
    ).run();

    expect(await repairScan(env, new Date('2026-09-01T00:00:00.000Z'))).toBe(1);
    expect(await repairScan(env, new Date('2026-09-01T00:15:00.000Z'))).toBe(0);

    expect(await env.DB.prepare(
      `SELECT count(*) AS n FROM standby_assignments
       WHERE week_id = 8101 AND participant_id = 8101`,
    ).first()).toEqual({ n: 1 });
    expect(await env.DB.prepare(
      `SELECT count(*) AS n FROM sessions
       WHERE week_id = 8101 AND interviewer_id = 8101`,
    ).first()).toEqual({ n: 1 });
    expect(await env.DB.prepare(
      `SELECT state, count(*) AS n FROM repair_queue
       WHERE week_id = 8101 GROUP BY state ORDER BY state`,
    ).all()).toMatchObject({
      results: [
        { state: 'matched', n: 1 },
        { state: 'open', n: 1 },
      ],
    });
  });
});
