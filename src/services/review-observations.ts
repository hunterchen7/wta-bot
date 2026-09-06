import { z } from 'zod';
import { aiReviewSchema } from './review-rubric-v3';
import { aiReviewV4Schema } from './review-rubric-v4';

export const REVIEW_OBSERVATION_VERSION = 'wta-review-observations-v1';

// Positive field lists keep new server-derived fields out of grader contracts.
const common = aiReviewSchema.pick({
  rubricVersion: true, roleAttribution: true, recap: true, sessionCompletion: true,
  hints: true, phaseTimeline: true, keyMoments: true, contradictions: true,
  confidence: true, organizerChecks: true,
});
const evidenceDisposition = aiReviewSchema.shape.evidenceDisposition.unwrap()
  .pick({ status: true, reason: true }).strict().optional();
const interviewer = aiReviewSchema.shape.interviewer.pick({ dimensions: true, criticalFlags: true }).strict();

export const reviewV3ObservationsSchema = common.extend({
  observationVersion: z.literal(REVIEW_OBSERVATION_VERSION),
  rubricVersion: z.literal('round3-review-v3'),
  evidenceDisposition,
  candidate: aiReviewSchema.shape.candidate.pick({ dimensions: true, solutionOutcome: true, rationale: true }).strict(),
  interviewer,
}).strict();

export const reviewV4ObservationsSchema = common.extend({
  observationVersion: z.literal(REVIEW_OBSERVATION_VERSION),
  rubricVersion: z.literal('round3-review-v4'),
  evidenceDisposition,
  assessmentEndedAtSeconds: aiReviewV4Schema.shape.assessmentEndedAtSeconds,
  hints: aiReviewV4Schema.shape.hints,
  candidate: aiReviewV4Schema.shape.candidate.pick({
    dimensions: true, technicalResult: true, assistanceProfile: true, rationale: true,
  }).strict(),
  interviewer,
}).strict();
