import { z } from 'zod';

export const REVIEW_RUBRIC_VERSION = 'round3-review-v3';

export const evidenceSchema = z.object({
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  note: z.string().min(1).max(1000),
  scope: z.enum(['moment', 'interval', 'session', 'report', 'code']).default('moment'),
}).refine((evidence) => evidence.endSeconds >= evidence.startSeconds, {
  message: 'Evidence cannot end before it starts.',
});

export const dimensionSchema = z.object({
  rating: z.number().int().min(1).max(4).nullable(),
  status: z.enum(['observed', 'not_observed']),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceSchema).max(12),
}).superRefine((dimension, context) => {
  if (dimension.status === 'observed' && dimension.rating === null) {
    context.addIssue({ code: 'custom', path: ['rating'], message: 'Observed dimensions require a rating.' });
  }
  if (dimension.status === 'observed' && dimension.evidence.length === 0) {
    context.addIssue({ code: 'custom', path: ['evidence'], message: 'Observed dimensions require evidence.' });
  }
  if (dimension.status === 'not_observed' && dimension.rating !== null) {
    context.addIssue({ code: 'custom', path: ['rating'], message: 'Unobserved dimensions cannot have a rating.' });
  }
});

const criticalFlagSchema = z.object({
  code: z.enum([
    'wrong_problem',
    'material_factual_error',
    'central_solution_disclosure',
    'implementation_led',
    'assessment_opportunity_denied',
    'unauthorized_candidate_external_ai_assistance',
    'harmful_conduct',
  ]),
  summary: z.string().min(1).max(1000),
  compromisesCandidateEvidence: z.boolean(),
  evidence: z.array(evidenceSchema).min(1).max(8),
});

export const interviewRoleSchema = z.enum(['interviewer', 'interviewee', 'unknown']);

const attributedParticipantSchema = z.object({
  participantId: z.number().int().positive(),
  name: z.string().min(1).max(200),
  evidence: z.array(evidenceSchema).min(1).max(12),
});

const roleTurnSchema = z.object({
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  role: interviewRoleSchema,
  confidence: z.number().min(0).max(1),
}).refine((turn) => turn.endSeconds >= turn.startSeconds, {
  message: 'A role-attribution turn cannot end before it starts.',
});

export const aiReviewSchema = z.object({
  rubricVersion: z.enum(['round3-review-v1', 'round3-review-v2', REVIEW_RUBRIC_VERSION]),
  evidenceDisposition: z.object({
    status: z.enum(['usable', 'unusable']),
    administrativeScore: z.literal(0).nullable(),
    reason: z.string().min(1).max(1000),
  }).optional(),
  roleAttribution: z.object({
    resolution: z.enum(['confirmed', 'partial', 'unresolved']),
    interviewer: attributedParticipantSchema,
    interviewee: attributedParticipantSchema,
    turns: z.array(roleTurnSchema).max(2000),
    rationale: z.string().min(1).max(3000),
  }).nullable().default(null),
  recap: z.string().min(1).max(4000),
  sessionCompletion: z.object({
    recommendation: z.enum(['completed', 'incomplete', 'unreviewable']),
    rationale: z.string().min(1).max(3000),
    evidence: z.array(evidenceSchema).max(12),
  }),
  candidate: z.object({
    dimensions: z.object({
      problemFraming: dimensionSchema,
      reasoning: dimensionSchema,
      implementation: dimensionSchema,
      testingAndComplexity: dimensionSchema,
      communication: dimensionSchema,
      independence: dimensionSchema,
      coachability: dimensionSchema,
    }),
    score: z.number().min(0).max(100).nullable(),
    readiness: z.enum(['strong_pass', 'pass', 'borderline', 'not_demonstrated', 'manual_review']),
    scoreBand: z.enum(['strong_pass', 'pass', 'borderline', 'not_demonstrated']).nullable().optional(),
    requiresManualReview: z.boolean().optional(),
    manualReviewReasons: z.array(z.string().min(1).max(1000)).max(20).optional(),
    solutionOutcome: z.enum([
      'not_observed',
      'no_viable_approach',
      'partial_insight',
      'correct_naive_described',
      'correct_naive_implemented_or_optimal_described',
      'optimal_mostly_implemented',
      'optimal_implemented_tested_and_analyzed',
    ]),
    rationale: z.string().min(1).max(3000),
  }),
  interviewer: z.object({
    dimensions: z.object({
      structure: dimensionSchema,
      questionFidelity: dimensionSchema,
      probing: dimensionSchema,
      hintDiscipline: dimensionSchema,
      timeManagement: dimensionSchema,
      feedbackAndConduct: dimensionSchema,
    }),
    score: z.number().min(0).max(100).nullable(),
    recommendation: z.enum(['strong', 'effective', 'coaching_recommended', 'organizer_follow_up']),
    requiresOrganizerReview: z.boolean().optional(),
    criticalFlags: z.array(z.union([z.string().max(1000), criticalFlagSchema])).max(20),
  }),
  hints: z.array(z.object({
    startSeconds: z.number().min(0),
    endSeconds: z.number().min(0),
    excerpt: z.string().min(1).max(1200),
    level: z.number().int().min(0).max(4),
    requested: z.boolean().nullable(),
    priorCandidateProgress: z.string().max(1500),
    matchedOfficialLadder: z.boolean().nullable(),
    smallerInterventionAvailable: z.boolean().nullable(),
    outcome: z.string().max(1500),
  })).max(100),
  phaseTimeline: z.array(z.object({
    phase: z.enum(['setup', 'clarification', 'approach', 'implementation', 'testing', 'complexity', 'feedback', 'downtime', 'wrap_up']),
    startSeconds: z.number().min(0),
    endSeconds: z.number().min(0),
    summary: z.string().min(1).max(1200),
    pacingControl: z.enum(['interviewer', 'candidate', 'shared', 'external', 'not_applicable']),
  }).refine((phase) => phase.endSeconds >= phase.startSeconds, {
    message: 'A phase cannot end before it starts.',
  })).max(30).default([]).superRefine((phases, context) => {
    phases.forEach((phase, index) => {
      const previous = phases[index - 1];
      if (previous && Math.abs(phase.startSeconds - previous.endSeconds) > 1) {
        context.addIssue({ code: 'custom', path: [index, 'startSeconds'], message: 'Phase timeline must be ordered and contiguous.' });
      }
    });
  }),
  keyMoments: z.array(z.object({
    startSeconds: z.number().min(0),
    endSeconds: z.number().min(0),
    title: z.string().min(1).max(200),
    note: z.string().min(1).max(1200),
  })).min(1).max(8),
  contradictions: z.array(z.object({
    summary: z.string().min(1).max(1200),
    evidence: z.array(evidenceSchema).max(8),
  })).max(20),
  confidence: z.object({
    transcript: z.number().min(0).max(1),
    speakerAttribution: z.number().min(0).max(1),
    overall: z.number().min(0).max(1),
  }),
  organizerChecks: z.array(z.string().max(1000)).max(20),
});

export type AiReview = z.infer<typeof aiReviewSchema>;

const candidateWeights = {
  problemFraming: 0.10,
  reasoning: 0.20,
  implementation: 0.20,
  testingAndComplexity: 0.15,
  communication: 0.10,
  independence: 0.15,
  coachability: 0.10,
} as const;

export const interviewerWeights = {
  structure: 0.15,
  questionFidelity: 0.15,
  probing: 0.20,
  hintDiscipline: 0.30,
  timeManagement: 0.10,
  feedbackAndConduct: 0.10,
} as const;

type WeightedDimensionMap = Record<string, {
  rating: number | null;
  status: 'observed' | 'not_observed';
  evidence: Array<{ startSeconds: number; endSeconds: number; scope: string }>;
}>;

export function weightedScore(
  dimensions: WeightedDimensionMap,
  weights: Record<string, number>,
): { raw: number | null; displayed: number | null; observedWeight: number } {
  let observedWeight = 0;
  let numerator = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const dimension = dimensions[key];
    if (!dimension || dimension.status !== 'observed' || dimension.rating === null) continue;
    observedWeight += weight;
    numerator += weight * (dimension.rating - 1);
  }
  if (observedWeight === 0) return { raw: null, displayed: null, observedWeight: 0 };
  const raw = (100 * numerator) / (3 * observedWeight);
  return { raw, displayed: Math.round(raw * 10) / 10, observedWeight };
}

export function candidateBand(score: number): 'strong_pass' | 'pass' | 'borderline' | 'not_demonstrated' {
  if (score >= 80) return 'strong_pass';
  if (score >= 65) return 'pass';
  if (score >= 50) return 'borderline';
  return 'not_demonstrated';
}

export function interviewerBand(score: number): 'strong' | 'effective' | 'coaching_recommended' | 'organizer_follow_up' {
  if (score >= 80) return 'strong';
  if (score >= 65) return 'effective';
  if (score >= 50) return 'coaching_recommended';
  return 'organizer_follow_up';
}

export function normalizeAiReview(review: AiReview): AiReview {
  const normalized = structuredClone(review);

  const unusableEvidence = normalized.evidenceDisposition?.status === 'unusable';

  const timeEvidence = normalized.interviewer.dimensions.timeManagement.evidence;
  const timelineDuration = normalized.phaseTimeline.at(-1)?.endSeconds ?? 0;
  const hasLongitudinalTimeEvidence = timeEvidence.some((evidence) =>
    evidence.scope === 'session'
      && timelineDuration > 0
      && evidence.endSeconds - evidence.startSeconds >= timelineDuration * 0.8,
  );
  if (normalized.interviewer.dimensions.timeManagement.status === 'observed' && !hasLongitudinalTimeEvidence) {
    normalized.interviewer.dimensions.timeManagement = {
      rating: null,
      status: 'not_observed',
      confidence: 0,
      evidence: timeEvidence,
    };
    normalized.organizerChecks = [
      ...normalized.organizerChecks,
      'Time management was left unscored because its evidence did not cover a meaningful session interval.',
    ];
  }

  const candidate = weightedScore(normalized.candidate.dimensions, candidateWeights);
  const criticalFlags = normalized.interviewer.criticalFlags;
  const compromisedFlagSummaries = criticalFlags.flatMap((flag) =>
    typeof flag === 'object' && flag.compromisesCandidateEvidence ? [flag.summary] : [],
  );
  const missingCandidateCore = ['reasoning', 'implementation', 'independence'].filter((key) =>
    normalized.candidate.dimensions[key as keyof typeof normalized.candidate.dimensions].status !== 'observed',
  );
  const candidateReasons = [
    ...(candidate.observedWeight < 0.70 ? ['Less than 70% of the candidate rubric had observable evidence.'] : []),
    ...(missingCandidateCore.length ? [`Core candidate dimensions were not observed: ${missingCandidateCore.join(', ')}.`] : []),
    ...(normalized.candidate.dimensions.independence.rating === 1 ? ['Candidate independence was rated 1.'] : []),
    ...compromisedFlagSummaries,
  ];
  normalized.candidate.score = unusableEvidence ? 0 : candidate.displayed;
  normalized.candidate.scoreBand = unusableEvidence
    ? 'not_demonstrated'
    : candidate.raw === null ? null : candidateBand(candidate.raw);
  normalized.candidate.requiresManualReview = unusableEvidence || candidate.raw === null || candidateReasons.length > 0;
  normalized.candidate.manualReviewReasons = unusableEvidence
    ? [`Administrative zero: ${normalized.evidenceDisposition!.reason}`]
    : candidate.raw === null
      ? ['No candidate dimensions had observable evidence.', ...candidateReasons]
      : candidateReasons;
  normalized.candidate.readiness = normalized.candidate.requiresManualReview
    ? 'manual_review'
    : normalized.candidate.scoreBand!;

  const interviewer = weightedScore(normalized.interviewer.dimensions, interviewerWeights);
  const missingInterviewerCore = ['questionFidelity', 'hintDiscipline', 'timeManagement'].some((key) =>
    normalized.interviewer.dimensions[key as keyof typeof normalized.interviewer.dimensions].status !== 'observed',
  );
  normalized.interviewer.score = interviewer.displayed;
  normalized.interviewer.recommendation = interviewer.raw === null
    ? 'organizer_follow_up'
    : interviewerBand(interviewer.raw);
  normalized.interviewer.requiresOrganizerReview = interviewer.raw === null
    || interviewer.observedWeight < 0.70
    || missingInterviewerCore
    || criticalFlags.length > 0;
  return normalized;
}
