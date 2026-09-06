import { aiReviewSchema, normalizeAiReview } from './review-rubric-v3';
import { aiReviewV4Schema, normalizeAiReviewV4 } from './review-rubric-v4';
import { reviewV3ObservationsSchema, reviewV4ObservationsSchema } from './review-observations';

function disposition(value: { status: 'usable' | 'unusable'; reason: string } | undefined) {
  return value ? { ...value, administrativeScore: value.status === 'unusable' ? 0 : null } : undefined;
}

/** Adapt observations to the stored legacy shape before server-only checks. */
export function reviewV3DraftFromObservations(input: unknown) {
  const observations = reviewV3ObservationsSchema.parse(input);
  return aiReviewSchema.parse({
    ...observations,
    evidenceDisposition: disposition(observations.evidenceDisposition),
    candidate: { ...observations.candidate, score: null, readiness: 'manual_review' },
    interviewer: { ...observations.interviewer, score: null, recommendation: 'organizer_follow_up' },
  });
}

export function scoreReviewV3Observations(input: unknown) {
  return normalizeAiReview(reviewV3DraftFromObservations(input));
}

export function scoreReviewV4Observations(input: unknown) {
  const observations = reviewV4ObservationsSchema.parse(input);
  const draft = aiReviewV4Schema.parse({
    ...observations,
    evidenceDisposition: disposition(observations.evidenceDisposition),
    candidate: { ...observations.candidate, score: null, readiness: 'manual_review' },
    interviewer: { ...observations.interviewer, score: null, recommendation: 'organizer_follow_up' },
  });
  return normalizeAiReviewV4(draft);
}
