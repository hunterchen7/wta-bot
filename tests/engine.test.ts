import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { drainOutbox, enqueue, enqueueMany } from '../src/engine/outbox';
import { demandFor } from '../src/engine/progress';
import { createCohort, weekAnchors } from '../src/engine/weeks';

describe('week anchors', () => {
  // 2026-09-14 is a Monday.
  const start: [number, number, number] = [2026, 9, 14];

  it('computes week 1 anchors in Toronto wall time (EDT)', () => {
    const a = weekAnchors(start, 1);
    expect(a.optin_opens_at.toISOString()).toBe('2026-09-11T20:00:00.000Z'); // Fri 16:00 EDT
    expect(a.optin_closes_at.toISOString()).toBe('2026-09-13T22:00:00.000Z'); // Sun 18:00
    expect(a.match_at.toISOString()).toBe('2026-09-13T22:15:00.000Z');
    expect(a.reports_due_at.toISOString()).toBe('2026-09-21T03:59:00.000Z'); // Sun 23:59 EDT
  });

  it('week 3 lands two weeks later with a grace window', () => {
    const w1 = weekAnchors(start, 1);
    const w3 = weekAnchors(start, 3);
    const days = (w3.match_at.getTime() - w1.match_at.getTime()) / 86400_000;
    expect(days).toBe(14);
    expect(w3.grace_until.getTime()).toBeGreaterThan(w3.reports_due_at.getTime());
  });

  it('createCohort persists weeks with grace only on the final week', async () => {
    const { cohortId, weeks } = await createCohort(env, 'Test Cohort', start);
    expect(cohortId).toBeGreaterThan(0);
    expect(weeks).toHaveLength(3);
    expect(weeks[0]!.grace_until).toBeNull();
    expect(weeks[2]!.grace_until).not.toBeNull();
    expect(weeks.map((w) => w.idx)).toEqual([1, 2, 3]);
  });
});

describe('demand math', () => {
  it('defaults to one per role', () => {
    expect(demandFor(1, { interviewer: 0, interviewee: 0 }, false)).toEqual({ interviewer: 1, interviewee: 1 });
  });
  it('doubles only when behind AND asked', () => {
    // Week 3, one interviewer credit (should have 2 by now)
    expect(demandFor(3, { interviewer: 1, interviewee: 2 }, true)).toEqual({ interviewer: 2, interviewee: 1 });
    expect(demandFor(3, { interviewer: 1, interviewee: 2 }, false)).toEqual({ interviewer: 1, interviewee: 1 });
  });
  it('never exceeds the remaining target', () => {
    expect(demandFor(3, { interviewer: 3, interviewee: 2 }, true)).toEqual({ interviewer: 0, interviewee: 1 });
    expect(demandFor(2, { interviewer: 2, interviewee: 3 }, true)).toEqual({ interviewer: 1, interviewee: 0 });
  });
});

describe('outbox', () => {
  it('drains within budget, retries failures with backoff, respects run_after', async () => {
    const executed: string[] = [];
    await enqueueMany(env, [
      { kind: 'dm', payload: { tag: 'a' } },
      { kind: 'dm', payload: { tag: 'fail' } },
      { kind: 'dm', payload: { tag: 'b' } },
      { kind: 'dm', payload: { tag: 'later' }, runAfter: new Date(Date.now() + 3600_000) },
    ]);

    const exec = async (_env: unknown, _kind: string, payload: any) => {
      if (payload.tag === 'fail') throw new Error('boom');
      executed.push(payload.tag);
    };

    // Budget 2: only first two rows attempted
    await drainOutbox(env, exec as any, 2);
    expect(executed).toEqual(['a']);

    // Next drain: 'b' runs; 'fail' is backed off (run_after in the future); 'later' not due
    await drainOutbox(env, exec as any, 10);
    expect(executed).toEqual(['a', 'b']);

    const { results } = await env.DB.prepare(
      'SELECT payload, attempts, done_at FROM outbox ORDER BY id',
    ).all<any>();
    expect(results).toHaveLength(4);
    const failed = results.find((r) => r.payload.includes('fail'));
    expect(failed.attempts).toBe(1);
    expect(failed.done_at).toBeNull();
  });

  it('single enqueue works and drains', async () => {
    let ran = 0;
    await enqueue(env, 'email', { to: 'x@y.z' });
    await drainOutbox(env, (async () => { ran++; }) as any, 50);
    expect(ran).toBeGreaterThan(0);
  });
});
