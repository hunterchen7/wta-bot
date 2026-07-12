import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { tick } from '../src/cron';

describe('cron tick', () => {
  it('is idempotent per minute-key', async () => {
    const now = new Date('2026-07-12T02:00:00Z');
    await tick(env, now);
    await tick(env, now); // same key — must not double-run
    const { results } = await env.DB.prepare('SELECT job_key FROM job_runs').all();
    expect(results.length).toBe(1);

    await tick(env, new Date('2026-07-12T02:15:00Z')); // next tick — new key
    const after = await env.DB.prepare('SELECT count(*) AS n FROM job_runs').first<{ n: number }>();
    expect(after?.n).toBe(2);
  });
});
