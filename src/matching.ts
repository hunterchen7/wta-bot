// Weekly matcher (DESIGN.md §3). Pure logic, no I/O.
//
// Each active participant has per-role demand (normally 1+1; catch-up doubles
// give 2 in a role). We emit directed edges (interviewer → interviewee) such
// that out-degree = interviewer demand and in-degree = interviewee demand,
// subject to hard constraints:
//   1. no self-pairing
//   2. no repeat counterpart within the cohort, in either direction
//      (`forbiddenPairs`, unordered — includes prior weeks and repairs)
//   3. no mutual pair within the week (if A interviews B, B must not
//      interview A that same week — that would recreate same-partner-swap)
//   4. no duplicate directed edge (a double never sees the same person twice)
//
// Randomized greedy with retries; returns the best attempt (fewest unmatched
// slots). Residual demand feeds the repair queue / admin digest.

export type Demand = { participantId: number; interviewer: number; interviewee: number };
export type Edge = { interviewerId: number; intervieweeId: number };
export type Unmatched = { participantId: number; role: 'interviewer' | 'interviewee'; count: number };
export type MatchResult = { edges: Edge[]; unmatched: Unmatched[] };

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export function matchWeek(
  demands: Demand[],
  forbiddenPairs: Iterable<readonly [number, number]>,
  opts: { attempts?: number; rng?: () => number } = {},
): MatchResult {
  const attempts = opts.attempts ?? 40;
  const rng = opts.rng ?? Math.random;
  const forbidden = new Set<string>();
  for (const [a, b] of forbiddenPairs) forbidden.add(pairKey(a, b));

  let best: MatchResult | null = null;
  for (let i = 0; i < attempts; i++) {
    const result = attempt(demands, forbidden, rng);
    if (!best || totalUnmatched(result) < totalUnmatched(best)) best = result;
    if (totalUnmatched(best) === 0) break;
  }
  return best ?? { edges: [], unmatched: [] };
}

const totalUnmatched = (r: MatchResult) => r.unmatched.reduce((n, u) => n + u.count, 0);

function attempt(demands: Demand[], forbidden: Set<string>, rng: () => number): MatchResult {
  // One slot per unit of interviewer demand, in random order.
  const outSlots: number[] = [];
  const remainingIn = new Map<number, number>();
  for (const d of demands) {
    for (let i = 0; i < d.interviewer; i++) outSlots.push(d.participantId);
    if (d.interviewee > 0) remainingIn.set(d.participantId, d.interviewee);
  }
  shuffle(outSlots, rng);

  const edges: Edge[] = [];
  const usedDirected = new Set<string>(); // "a>b"
  const usedThisWeek = new Set<string>(); // unordered — blocks mutual pairs
  const unfilledOut = new Map<number, number>();

  for (const interviewer of outSlots) {
    // Valid candidates, most-constrained-friendly: prefer highest remaining
    // interviewee demand to keep the tail of the assignment feasible.
    let pick: number | null = null;
    let pickRemaining = -1;
    for (const [candidate, remaining] of remainingIn) {
      if (remaining <= 0 || candidate === interviewer) continue;
      if (forbidden.has(pairKey(interviewer, candidate))) continue;
      if (usedThisWeek.has(pairKey(interviewer, candidate))) continue;
      if (usedDirected.has(`${interviewer}>${candidate}`)) continue;
      if (remaining > pickRemaining) {
        pick = candidate;
        pickRemaining = remaining;
      }
    }
    if (pick === null) {
      unfilledOut.set(interviewer, (unfilledOut.get(interviewer) ?? 0) + 1);
      continue;
    }
    edges.push({ interviewerId: interviewer, intervieweeId: pick });
    usedDirected.add(`${interviewer}>${pick}`);
    usedThisWeek.add(pairKey(interviewer, pick));
    remainingIn.set(pick, (remainingIn.get(pick) ?? 0) - 1);
  }

  const unmatched: Unmatched[] = [];
  for (const [participantId, count] of unfilledOut) {
    unmatched.push({ participantId, role: 'interviewer', count });
  }
  for (const [participantId, count] of remainingIn) {
    if (count > 0) unmatched.push({ participantId, role: 'interviewee', count });
  }
  return { edges, unmatched };
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}
