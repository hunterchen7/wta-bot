import { describe, expect, it } from 'vitest';
import { aiReviewSchema, normalizeAiReview } from '../src/services/review-rubric-v3';
import { aiReviewV4Schema, normalizeAiReviewV4 } from '../src/services/review-rubric-v4';
const e = [{ startSeconds: 0, endSeconds: 600, scope: 'session' as const, note: 'Full recorded assessment and submitted artifact.' }];
const d = (rating: number) => ({ rating, status: 'observed', confidence: .9, evidence: e });
function draft() {
 return aiReviewV4Schema.parse({
 rubricVersion:'round3-review-v4',recap:'Recorded interview',assessmentEndedAtSeconds:600,
 roleAttribution:{resolution:'confirmed',interviewer:{participantId:1,name:'Interviewer',evidence:e},interviewee:{participantId:2,name:'Candidate',evidence:e},turns:[{startSeconds:0,endSeconds:600,role:'interviewee',confidence:.9}],rationale:'Resolved from assigned roles.'},
 sessionCompletion:{recommendation:'completed',rationale:'Substantive interview.',evidence:e},
 candidate:{dimensions:{problemFraming:d(2),reasoning:d(3),implementation:d(4),testing:d(3),complexity:d(3),communication:d(3),independence:d(2),coachability:d(3)},score:100,readiness:'strong_pass',rationale:'Correct assisted result.',technicalResult:{approach:'correct_optimal',artifact:'correct_optimal',verification:{status:'confirmed',artifactSha256:'a'.repeat(64),runtime:'Python',checks:'Packet examples and edge cases passed.',evidence:e}},assistanceProfile:[]},
 interviewer:{dimensions:Object.fromEntries(['structure','questionFidelity','probing','hintDiscipline','timeManagement','feedbackAndConduct'].map(k=>[k,d(3)])),score:0,recommendation:'strong',criticalFlags:[]},
 hints:[],phaseTimeline:[{phase:'implementation',startSeconds:0,endSeconds:600,summary:'Complete interview',pacingControl:'shared'}],keyMoments:[{startSeconds:0,endSeconds:600,title:'Interview',note:'Complete evidence.'}],contradictions:[],confidence:{transcript:.9,speakerAttribution:.9,overall:.9},organizerChecks:[]});
}
describe('v4 calibration',()=>{
 it('uses the exact score at band boundaries',()=>{
  const r=draft();
  const ratings={problemFraming:4,reasoning:4,implementation:4,testing:4,complexity:2,communication:3,independence:3,coachability:1};
  for(const key of Object.keys(ratings) as Array<keyof typeof ratings>) r.candidate.dimensions[key].rating=ratings[key];
  const n=normalizeAiReviewV4(r);expect(n.candidate.rawScore).toBe(80);expect(n.candidate.scoreBand).toBe('strong_pass');
 });
 it('credits supplied tests and a correct assisted artifact',()=>{const r=normalizeAiReviewV4(draft());expect(r.candidate.score).toBe(63.3);expect(r.candidate.technicalScore).toBe(77.8);expect(r.candidate.assistance).toBe('substantially_assisted');});
 it('keeps interviewer-led optimal work above independent failed work',()=>{
  const solved=draft(); solved.candidate.dimensions.independence=d(1) as typeof solved.candidate.dimensions.independence;solved.candidate.dimensions.reasoning.rating=2;
  const failed=draft(); failed.candidate.dimensions.independence.rating=4;failed.candidate.dimensions.implementation.rating=2;failed.candidate.technicalResult.artifact='non_runnable';
  const a=normalizeAiReviewV4(solved),b=normalizeAiReviewV4(failed);expect(a.candidate.score).toBe(55);expect(a.candidate.scoreAdjustment).toBe('floor_55');expect(b.candidate.score).toBeLessThanOrEqual(49);expect(a.candidate.readiness).toBe('manual_review');
 });
 it('holds contradictory outcomes instead of manufacturing implementation credit',()=>{const r=draft();r.candidate.dimensions.implementation.rating=2;const n=normalizeAiReviewV4(r);expect(n.candidate.score).toBeNull();expect(n.candidate.scoreAdjustment).toBe('pending');});
 it('does not turn missing verification or independence into a low performance score',()=>{const r=draft();r.candidate.technicalResult.verification.status='pending';expect(normalizeAiReviewV4(r).candidate.score).toBeNull();r.candidate.technicalResult.verification.status='confirmed';r.candidate.dimensions.independence={status:'not_observed',rating:null,confidence:0,evidence:[]};expect(normalizeAiReviewV4(r).candidate.score).toBeNull();});
 it('keeps flags and confidence separate from numeric scoring, excludes debrief hints',()=>{
  const r=draft();r.hints=[{startSeconds:100,endSeconds:110,level:3,excerpt:'Use the central state',requested:true,priorCandidateProgress:'Partial',matchedOfficialLadder:true,smallerInterventionAvailable:false,outcome:'Progress',duringAssessment:true}];
  const before=normalizeAiReviewV4(r);expect(before.candidate.score).toBe(63.3);expect(before.candidate.readiness).toBe('manual_review');
  r.hints[0]!.duringAssessment=false;r.assessmentEndedAtSeconds=90;r.confidence.overall=.2;const after=normalizeAiReviewV4(r);expect(after.candidate.score).toBe(before.candidate.score);expect(after.candidate.readiness).toBe('borderline');
 });
 it('renormalizes missing complexity only inside technical block and is idempotent',()=>{
  const r=draft();r.candidate.dimensions.complexity={status:'not_observed',rating:null,confidence:0,evidence:[]};const n=normalizeAiReviewV4(r);expect(n.candidate.independenceScore).toBe(33.3);expect(n.candidate.technicalCoverage).toBe(55/60);expect(normalizeAiReviewV4(n)).toEqual(n);
 });
 it('preserves legacy rubric versions when normalizing',()=>{
  const r=draft(); const legacy=aiReviewSchema.parse({...r,rubricVersion:'round3-review-v2',candidate:{...r.candidate,dimensions:{...r.candidate.dimensions,testingAndComplexity:d(3)},solutionOutcome:'optimal_implemented_tested_and_analyzed'}});
  expect(normalizeAiReview(legacy).rubricVersion).toBe('round3-review-v2');
 });
});
