import { z } from 'zod';
import { aiReviewSchema, dimensionSchema, evidenceSchema, weightedScore, candidateBand, interviewerBand, interviewerWeights } from './review-rubric-v3';

export const REVIEW_V4_VERSION = 'round3-review-v4';
export const LOCAL_REVIEW_MODEL = 'gpt-6-astra';
export const LOCAL_REVIEW_EFFORT = 'max';
export const LOCAL_REVIEW_SERVICE_TIER = 'default';

export const technicalWeights = { problemFraming: 5, reasoning: 15, implementation: 25, testing: 10, complexity: 5 } as const;
const interactionWeights = { communication: 5, coachability: 5 } as const;
export const candidateV4Anchors = {
  problemFraming: ['Task model remains materially wrong.', 'Basic goal understood, but material misconceptions or missed constraints substantially delay progress.', 'Correctly models the goal, input rules, and relevant constraints.', 'Uses a precise model, assumptions, and constraint-driven examples to guide decisions.'],
  reasoning: ['No coherent explanation of an approach.', 'Partial or plausible explanation; important transitions, invariants, or correctness claims remain unresolved when probed.', 'Explains a correct approach and why its key transitions work, including an explanation developed after help.', 'Justifies invariants and design choices, connects them to implementation, and adapts using counterevidence or meaningful alternatives.'],
  implementation: ['Little relevant code or no coherent algorithmic structure.', 'Meaningful implementation with major correctness, termination, compilation, or completeness defects.', 'Complete correct baseline that misses required efficiency, or a near-complete intended solution with genuinely localized defects.', 'Coherent, runnable implementation correct for the assigned requirements and required resource constraints. Assistance does not change this rating.'],
  testing: ['Despite a usable opportunity, no meaningful behavior check, or clear failures are ignored.', 'Useful cases executed or traced, but validation remains unresolved or too limited to establish the result.', 'Runs supplied tests, checks expected outputs, and resolves observed failures. No extra candidate-authored cases required. Equivalent substantive traces may address a documented harness limitation without claiming execution.', 'Adds diagnostic validation beyond routine pass/fail checks: targeted cases, invariant-driven traces, or checks exposing or ruling out subtle defects, explaining their purpose.'],
  complexity: ['Materially wrong bound or cannot explain relevant cost when asked.', 'Partially correct analysis with missing time/space component, weak justification, or unresolved cost assumption.', 'Correct time and auxiliary-space bounds for the actual code with a sound explanation, including after prompting or correction.', 'Derives tight bounds with precise accounting for relevant operations, amortization, recursion, heap work, or temporary allocations, connected to constraints or trade-offs.'],
  independence: ['Interviewer supplies central design and/or substantial implementation sequence, leaving little candidate design ownership.', 'Core milestones require disclosures, but candidate owns meaningful subsequent work.', 'Candidate drives approach and implementation with clarification and limited directional help.', 'No substantive solution help for milestones actually attempted; failure to finish, test, or analyze is assessed elsewhere.'],
  communication: ['Technical decisions cannot be followed because explanations are absent or incoherent.', 'Intermittently followable with important unexplained decisions or changes.', 'Explains approach, changes, and results clearly enough to follow.', 'Structured technical explanation with explicit assumptions, trade-offs, and corrections.'],
  coachability: ['Does not engage with feedback or use it productively.', 'Repeats a demonstrated misunderstanding or only partially incorporates feedback.', 'Understands feedback and continues productively.', 'Explains feedback implications, makes the appropriate correction, and validates recovery.'],
} as const;

const resultSchema = z.object({
  approach: z.enum(['not_observed', 'none', 'partial', 'correct_baseline', 'correct_optimal']),
  artifact: z.enum(['not_observed', 'no_submission', 'incomplete', 'non_runnable', 'incorrect', 'correct_baseline', 'correct_optimal']),
  verification: z.object({
    status: z.enum(['pending', 'confirmed', 'contradicted']),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    runtime: z.string().max(1000),
    checks: z.string().max(8000),
    evidence: z.array(evidenceSchema).max(12),
  }),
});
const candidateSchema = aiReviewSchema.shape.candidate.omit({ dimensions: true, solutionOutcome: true }).extend({
  dimensions: z.object({
    problemFraming: dimensionSchema, reasoning: dimensionSchema, implementation: dimensionSchema,
    testing: dimensionSchema, complexity: dimensionSchema, communication: dimensionSchema,
    independence: dimensionSchema, coachability: dimensionSchema,
  }),
  technicalResult: resultSchema,
  assistanceProfile: z.array(z.object({ milestone: z.string().min(1).max(150), summary: z.string().min(1).max(1500), evidence: z.array(evidenceSchema).min(1).max(8) })).max(10),
  solutionOutcome: z.string().default('not_observed'),
  technicalScore: z.number().nullable().optional(),
  technicalCoverage: z.number().optional(),
  independenceScore: z.number().nullable().optional(),
  interactionScore: z.number().nullable().optional(),
  preBoundScore: z.number().nullable().optional(),
  rawScore: z.number().nullable().optional(),
  scoreAdjustment: z.enum(['none', 'floor_55', 'ceiling_54', 'ceiling_49', 'pending', 'administrative_zero']).optional(),
  assistance: z.enum(['independent', 'lightly_assisted', 'substantially_assisted', 'interviewer_led', 'not_observed']).optional(),
});
export const aiReviewV4Schema = aiReviewSchema.omit({ rubricVersion: true, candidate: true, hints: true }).extend({
  rubricVersion: z.literal(REVIEW_V4_VERSION),
  candidate: candidateSchema,
  assessmentEndedAtSeconds: z.number().nonnegative(),
  hints: z.array(aiReviewSchema.shape.hints.element.extend({ duringAssessment: z.boolean() })).max(100),
});
export type AiReviewV4 = z.infer<typeof aiReviewV4Schema>;

function compositeScore(dimensions: AiReviewV4['candidate']['dimensions']): number | null {
  // Keep integer rating arithmetic until the final division. Separate floating
  // point block calculations can put an exact 65 or 80 just below its band.
  let numerator = 0;
  let denominator = 1;
  for (const [weights, share] of [[technicalWeights, 60], [{ independence: 30 }, 30], [interactionWeights, 10]] as const) {
    let points = 0;
    let observedWeight = 0;
    for (const [key, weight] of Object.entries(weights)) {
      const dimension = dimensions[key as keyof typeof dimensions];
      if (dimension.status !== 'observed' || dimension.rating === null) continue;
      points += weight * (dimension.rating - 1);
      observedWeight += weight;
    }
    if (!observedWeight) return null;
    const blockDenominator = observedWeight * 3;
    numerator = numerator * blockDenominator + points * share * denominator;
    denominator *= blockDenominator;
  }
  return numerator / denominator;
}

export function normalizeAiReviewV4(input: AiReviewV4): AiReviewV4 {
  const review = structuredClone(input);
  const candidate = review.candidate;
  const dims = candidate.dimensions;
  const technical = weightedScore(dims, technicalWeights);
  const independence = weightedScore(dims, { independence: 30 });
  const interaction = weightedScore(dims, interactionWeights);
  const reasons: string[] = [];
  const unusable = review.evidenceDisposition?.status === 'unusable';
  const result = candidate.technicalResult;
  candidate.technicalScore = technical.displayed;
  candidate.technicalCoverage = technical.observedWeight / 60;
  candidate.independenceScore = independence.displayed;
  candidate.interactionScore = interaction.displayed;
  candidate.assistance = dims.independence.rating === 4 ? 'independent' : dims.independence.rating === 3 ? 'lightly_assisted'
    : dims.independence.rating === 2 ? 'substantially_assisted' : dims.independence.rating === 1 ? 'interviewer_led' : 'not_observed';
  candidate.solutionOutcome = result.artifact === 'not_observed' ? 'not_observed'
    : `${result.approach}_approach_${result.artifact}_artifact`;

  if (technical.observedWeight < 42) reasons.push('Less than 70% of technical rubric weight was observed.');
  const missingCore = ['reasoning', 'implementation', 'independence'].filter(key => dims[key as keyof typeof dims].status !== 'observed');
  if (missingCore.length) reasons.push(`Core dimensions not observed: ${missingCore.join(', ')}.`);
  if (interaction.raw === null) reasons.push('Neither communication nor recovery was observed.');
  let rankable = technical.observedWeight >= 42 && missingCore.length === 0 && interaction.raw !== null;
  if (result.verification.status !== 'confirmed' || result.verification.evidence.length === 0 || result.artifact === 'not_observed') {
    reasons.push('Final artifact requires verification or reconciliation.');
    rankable = false;
  }
  if (result.artifact === 'correct_optimal' && (dims.implementation.rating !== 4 || result.approach !== 'correct_optimal')) {
    reasons.push('Verified optimal outcome conflicts with the implementation rating or approach; reconcile the evidence.');
    rankable = false;
  }
  if (result.artifact === 'correct_baseline' && dims.implementation.rating !== 3) {
    reasons.push('Correct baseline outcome requires a consistent implementation rating of 3.');
    rankable = false;
  }
  if (!['not_observed', 'no_submission'].includes(result.artifact) && !result.verification.artifactSha256) {
    reasons.push('Verification must identify the exact submitted artifact.');
    rankable = false;
  }
  if (['incomplete', 'non_runnable', 'incorrect', 'no_submission'].includes(result.artifact) && dims.implementation.rating === 4) {
    reasons.push('Failed or absent artifact conflicts with implementation rating 4.');
    rankable = false;
  }
  if (review.roleAttribution?.resolution !== 'confirmed') reasons.push('Material speaker attribution needs organizer confirmation.');
  if (dims.independence.rating === 1) reasons.push('The assessed work was interviewer-led.');
  if (review.hints.some(h => h.duringAssessment && h.level >= 3)) reasons.push('A central technique or implementation step was disclosed during the assessed attempt.');
  if (review.hints.some(h => h.duringAssessment && h.startSeconds >= review.assessmentEndedAtSeconds)) {
    reasons.push('Hint attribution conflicts with the assessment cutoff.');
    rankable = false;
  }
  for (const flag of review.interviewer.criticalFlags) {
    if (typeof flag === 'object' && flag.compromisesCandidateEvidence) reasons.push(flag.summary);
  }
  candidate.preBoundScore = compositeScore(dims);
  let score = rankable ? candidate.preBoundScore : null;
  candidate.scoreAdjustment = score === null ? 'pending' : 'none';
  if (score !== null) {
    if (result.artifact === 'correct_optimal' && score < 55) { score = 55; candidate.scoreAdjustment = 'floor_55'; }
    else if (result.artifact === 'correct_baseline' && score > 54) { score = 54; candidate.scoreAdjustment = 'ceiling_54'; }
    else if (['incomplete', 'non_runnable', 'incorrect', 'no_submission'].includes(result.artifact) && score > 49) { score = 49; candidate.scoreAdjustment = 'ceiling_49'; }
  }
  if (unusable) {
    score = null;
    candidate.scoreAdjustment = 'administrative_zero';
    reasons.splice(0, reasons.length, `Administrative zero: ${review.evidenceDisposition!.reason}`);
  }
  candidate.rawScore = score;
  candidate.score = unusable ? 0 : score === null ? null : Math.round(score * 10) / 10;
  candidate.scoreBand = score === null ? null : candidateBand(score);
  candidate.requiresManualReview = unusable || score === null || reasons.length > 0;
  candidate.manualReviewReasons = [...new Set(reasons)];
  candidate.readiness = candidate.requiresManualReview ? 'manual_review' : candidate.scoreBand!;

  const time = review.interviewer.dimensions.timeManagement;
  const duration = review.phaseTimeline.at(-1)?.endSeconds ?? 0;
  if (time.status === 'observed' && !time.evidence.some(e => e.scope === 'session' && duration > 0 && e.endSeconds - e.startSeconds >= duration * .8)) {
    review.interviewer.dimensions.timeManagement = { ...time, status: 'not_observed', rating: null, confidence: 0 };
    review.organizerChecks = [...new Set([...review.organizerChecks, 'Time management was left unscored because its evidence did not cover a meaningful session interval.'])];
  }
  const interviewer = weightedScore(review.interviewer.dimensions, interviewerWeights);
  review.interviewer.score = interviewer.displayed;
  review.interviewer.recommendation = interviewer.raw === null ? 'organizer_follow_up' : interviewerBand(interviewer.raw);
  review.interviewer.requiresOrganizerReview = interviewer.raw === null || interviewer.observedWeight < .7
    || ['questionFidelity', 'hintDiscipline', 'timeManagement'].some(k => review.interviewer.dimensions[k as keyof typeof review.interviewer.dimensions].status !== 'observed')
    || review.interviewer.criticalFlags.length > 0;
  return review;
}
