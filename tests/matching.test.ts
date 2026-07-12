import { describe, expect, it } from 'vitest';
import { matchWeek, type Demand, type Edge } from '../src/matching';

// Deterministic RNG so failures reproduce.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uniform = (n: number): Demand[] =>
  Array.from({ length: n }, (_, i) => ({ participantId: i + 1, interviewer: 1, interviewee: 1 }));

function assertInvariants(edges: Edge[], demands: Demand[], forbidden: Array<[number, number]>) {
  const forbiddenSet = new Set(forbidden.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));
  const seenPairs = new Set<string>();
  for (const e of edges) {
    expect(e.interviewerId).not.toBe(e.intervieweeId); // no self
    const key =
      e.interviewerId < e.intervieweeId
        ? `${e.interviewerId}:${e.intervieweeId}`
        : `${e.intervieweeId}:${e.interviewerId}`;
    expect(forbiddenSet.has(key), `repeat pair ${key}`).toBe(false);
    expect(seenPairs.has(key), `mutual/duplicate pair ${key} in week`).toBe(false);
    seenPairs.add(key);
  }
  // degree checks
  for (const d of demands) {
    const out = edges.filter((e) => e.interviewerId === d.participantId).length;
    const inn = edges.filter((e) => e.intervieweeId === d.participantId).length;
    expect(out).toBeLessThanOrEqual(d.interviewer);
    expect(inn).toBeLessThanOrEqual(d.interviewee);
  }
}

describe('matchWeek', () => {
  it('perfectly matches a uniform pool', () => {
    const demands = uniform(10);
    const result = matchWeek(demands, [], { rng: mulberry32(1) });
    expect(result.unmatched).toEqual([]);
    expect(result.edges.length).toBe(10);
    assertInvariants(result.edges, demands, []);
  });

  it('handles a pool of 3 (cycle) and fails a pool of 2 honestly', () => {
    const three = matchWeek(uniform(3), [], { rng: mulberry32(2) });
    expect(three.unmatched).toEqual([]);
    assertInvariants(three.edges, uniform(3), []);

    // Two people can only satisfy each other mutually — which is banned.
    const two = matchWeek(uniform(2), [], { rng: mulberry32(3) });
    expect(two.unmatched.length).toBeGreaterThan(0);
  });

  it('gives catch-up doubles two distinct partners per role', () => {
    const demands: Demand[] = [
      { participantId: 1, interviewer: 2, interviewee: 2 }, // behind pace
      ...uniform(7).map((d) => ({ ...d, participantId: d.participantId + 1 })),
    ];
    const result = matchWeek(demands, [], { rng: mulberry32(4) });
    expect(result.unmatched).toEqual([]);
    const myInterviewees = result.edges.filter((e) => e.interviewerId === 1).map((e) => e.intervieweeId);
    const myInterviewers = result.edges.filter((e) => e.intervieweeId === 1).map((e) => e.interviewerId);
    expect(new Set(myInterviewees).size).toBe(2);
    expect(new Set(myInterviewers).size).toBe(2);
    assertInvariants(result.edges, demands, []);
  });

  it('never repeats counterparts across a full 3-week cohort', () => {
    const demands = uniform(12);
    const forbidden: Array<[number, number]> = [];
    const partnersOf = new Map<number, Set<number>>();

    for (let week = 1; week <= 3; week++) {
      const result = matchWeek(demands, forbidden, { rng: mulberry32(10 + week) });
      expect(result.unmatched).toEqual([]);
      assertInvariants(result.edges, demands, forbidden);
      for (const e of result.edges) {
        forbidden.push([e.interviewerId, e.intervieweeId]);
        (partnersOf.get(e.interviewerId) ?? partnersOf.set(e.interviewerId, new Set()).get(e.interviewerId)!).add(e.intervieweeId);
        (partnersOf.get(e.intervieweeId) ?? partnersOf.set(e.intervieweeId, new Set()).get(e.intervieweeId)!).add(e.interviewerId);
      }
    }
    // 3 weeks × 2 sessions = 6 distinct humans met, for everyone.
    for (const [, partners] of partnersOf) expect(partners.size).toBe(6);
  });

  it('reports honest residuals when the pool is over-constrained', () => {
    // 4 people where almost everyone has already met — repairs/digest material.
    const demands = uniform(4);
    const forbidden: Array<[number, number]> = [
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 3],
    ];
    const result = matchWeek(demands, forbidden, { rng: mulberry32(6) });
    assertInvariants(result.edges, demands, forbidden);
    expect(result.unmatched.length).toBeGreaterThan(0);
  });

  it('is deterministic under a seeded rng', () => {
    const a = matchWeek(uniform(20), [], { rng: mulberry32(42) });
    const b = matchWeek(uniform(20), [], { rng: mulberry32(42) });
    expect(a).toEqual(b);
  });

  it('scales to cohort size with doubles mixed in', () => {
    const demands: Demand[] = Array.from({ length: 150 }, (_, i) => ({
      participantId: i + 1,
      interviewer: i % 10 === 0 ? 2 : 1,
      interviewee: i % 10 === 0 ? 2 : 1,
    }));
    const result = matchWeek(demands, [], { rng: mulberry32(7) });
    expect(result.unmatched).toEqual([]);
    assertInvariants(result.edges, demands, []);
  });
});
