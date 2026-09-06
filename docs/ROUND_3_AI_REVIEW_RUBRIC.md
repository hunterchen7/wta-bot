# Round 3 Recording Review Rubric

> **Status:** Shadow audit; organizer calibration required before activation
> **Rubric version:** `round3-review-v4`
> **Applies to:** Human organizer reviews and AI-assisted reviews of Round 3 interview recordings

## Purpose

Round 3 recording review serves three related but separate purposes:

1. Confirm that the participant completed a genuine mock interview.
2. Assess the interviewee's current technical-interview readiness, including whether their performance supports advancement to the alumni interview or referral process.
3. Assess whether the interviewer conducted a fair, useful interview and used hints appropriately.

Completion is not the same as passing. A participant can complete the interview without solving the problem. A technically strong result can also provide weak evidence of independent ability if the interviewer supplied most of the solution.

The AI review is advisory. It must never automatically approve completion, determine eligibility, reject a participant, or change a human review. An organizer makes the final decisions.

For locally verified reviews, follow the standardized input and two-pass procedure in [ROUND_3_LOCAL_SUBAGENT_REVIEW.md](./ROUND_3_LOCAL_SUBAGENT_REVIEW.md).

## Review inputs

The reviewer should receive:

- the recording;
- a timestamped, speaker-attributed transcript;
- the assigned problem statement, interviewer notes, hint ladder, and solution;
- the submitted code;
- the interviewer and interviewee reports;
- the scheduled duration and relevant session metadata.

The AI must resolve the assigned people before it evaluates either role. Session metadata is authoritative for the names and assignments: the assigned interviewer is `INTERVIEWER`; the assigned interviewee is the `INTERVIEWEE` and technical candidate. The recording uploader identifies which participant submitted the recording, but it does not prove who spoke in every segment.

The reviewer must map transcript turns to those named roles, label every transcript segment `INTERVIEWER`, `INTERVIEWEE`, or `UNKNOWN`, and persist that mapping with confidence and evidence. It must use `UNKNOWN` rather than silently guessing. If material turns cannot be resolved, it must lower speaker-attribution confidence and leave affected dimensions unobserved or request organizer confirmation. The organizer must be able to inspect the role-labeled transcript.

Each submitted report must be attributed to its assignee and role. Reports are secondary evidence: they can corroborate timing, hints, solution milestones, and participant experience, and they can expose contradictions. They cannot override conflicting recording, transcript, submitted-code, or problem-packet evidence. An interviewer-report statement must never be attributed to the interviewee, or vice versa.

## Evidence rules

Every AI rating and material claim must cite evidence. Evidence is classified as a local `moment`, a meaningful `interval`, a whole-`session` conclusion, a submitted `report`, or submitted `code`. A claim without supporting evidence must be omitted or marked `not_observed`.

Before assigning ratings, the reviewer must read the complete transcript and build a phase timeline covering the full usable recording. For each dimension, it must consider the opportunity to demonstrate the behaviour, representative supporting evidence, material counterevidence, and evidence limitations.

Session completion and time management are longitudinal judgments. They must cite the opening, stopping point, and relevant phase or session ranges. A single isolated timestamp cannot support either judgment.

The AI must:

- score only behaviour demonstrated during the recorded session;
- distinguish transcription uncertainty from participant performance;
- identify contradictions between the recording, transcript, code, and submitted reports;
- use the known problem packet when judging correctness and hint disclosure;
- lower its confidence when audio, speaker attribution, screen visibility, or transcript quality is poor;
- return `insufficient_evidence` instead of assigning a low score when the evidence is not reviewable.

An interviewer may privately use external tools, including AI, to inspect or verify the interviewee's code. This is allowed and does not itself compromise candidate evidence. Evaluate only the help actually communicated to the interviewee under probing, hint discipline, and candidate independence. Treat external AI as an integrity issue only when the candidate uses it without authorization. If an interviewer relays an externally generated solution, classify the relayed help under the existing solution-disclosure or implementation-led rules instead of penalizing the private tool use twice.

The AI must not score accent, dialect, speaking speed, vocal confidence, filler words, camera use, appearance, personality, or similarity to a preferred communication style. Communication is assessed only on whether the technical reasoning can be followed.

## Decision 1: Session completion

This decision measures participation and session integrity, not whether the problem was solved.

### `completed`

Use when the recording shows a good-faith, substantive technical interview. The interviewee engaged with the assigned problem, explained or attempted an approach, and participated through a reasonable stopping point. A wrong or incomplete solution can still be a completed interview.

### `incomplete`

Use when there was no substantive interview, including an effective no-show, a session that ended before a meaningful attempt, use of the wrong participant or problem without organizer approval, or an interview performed almost entirely by the interviewer.

### `unreviewable`

Use when missing or unusable evidence prevents the reviewer from deciding. Examples include a missing recording, unintelligible audio, an apparently truncated upload, or a transcript and recording that cannot be reconciled.

When an organizer confirms that the submitted recording is unusable, the system may record an **administrative score of 0**. This is an evidence-quality outcome, not a claim that the candidate demonstrated rating-1 performance. Keep every unsupported candidate and interviewer dimension `not_observed`, set the solution outcome to `not_observed`, state the concrete recording defect, and require manual review. A replacement recording can supersede the administrative zero.

The AI provides a recommendation and evidence. Only an organizer confirms the completion decision.

## Decision 2: Candidate readiness

Rate each dimension from 1 to 4. Use `not_observed` when the session did not provide enough evidence. Do not convert `not_observed` into a score of 1.

### problemFraming — 5%

| Rating | Anchor |
| --- | --- |
| 1 | Task model remains materially wrong. |
| 2 | Basic goal understood, but material misconceptions or missed constraints substantially delay progress. |
| 3 | Correctly models the goal, input rules, and relevant constraints. |
| 4 | Uses a precise model, assumptions, and constraint-driven examples to guide decisions. |

### reasoning — 15%

| Rating | Anchor |
| --- | --- |
| 1 | No coherent explanation of an approach. |
| 2 | Partial or plausible explanation; important transitions, invariants, or correctness claims remain unresolved when probed. |
| 3 | Explains a correct approach and why its key transitions work, including an explanation developed after help. |
| 4 | Justifies invariants and design choices, connects them to implementation, and adapts using counterevidence or meaningful alternatives. |

### implementation — 25%

| Rating | Anchor |
| --- | --- |
| 1 | Little relevant code or no coherent algorithmic structure. |
| 2 | Meaningful implementation with major correctness, termination, compilation, or completeness defects. |
| 3 | Complete correct baseline that misses required efficiency, or a near-complete intended solution with genuinely localized defects. |
| 4 | Coherent, runnable implementation correct for the assigned requirements and required resource constraints. Assistance does not change this rating. |

### testing — 10%

| Rating | Anchor |
| --- | --- |
| 1 | Despite a usable opportunity, no meaningful behavior check, or clear failures are ignored. |
| 2 | Useful cases executed or traced, but validation remains unresolved or too limited to establish the result. |
| 3 | Runs supplied tests, checks expected outputs, and resolves observed failures. No extra candidate-authored cases required. Equivalent substantive traces may address a documented harness limitation without claiming execution. |
| 4 | Adds diagnostic validation beyond routine pass/fail checks: targeted cases, invariant-driven traces, or checks exposing or ruling out subtle defects, explaining their purpose. |

### complexity — 5%

| Rating | Anchor |
| --- | --- |
| 1 | Materially wrong bound or cannot explain relevant cost when asked. |
| 2 | Partially correct analysis with missing time/space component, weak justification, or unresolved cost assumption. |
| 3 | Correct time and auxiliary-space bounds for the actual code with a sound explanation, including after prompting or correction. |
| 4 | Derives tight bounds with precise accounting for relevant operations, amortization, recursion, heap work, or temporary allocations, connected to constraints or trade-offs. |

### communication — 5%

| Rating | Anchor |
| --- | --- |
| 1 | Technical decisions cannot be followed because explanations are absent or incoherent. |
| 2 | Intermittently followable with important unexplained decisions or changes. |
| 3 | Explains approach, changes, and results clearly enough to follow. |
| 4 | Structured technical explanation with explicit assumptions, trade-offs, and corrections. |

### independence — 30%

| Rating | Anchor |
| --- | --- |
| 1 | Interviewer supplies central design and/or substantial implementation sequence, leaving little candidate design ownership. |
| 2 | Core milestones require disclosures, but candidate owns meaningful subsequent work. |
| 3 | Candidate drives approach and implementation with clarification and limited directional help. |
| 4 | No substantive solution help for milestones actually attempted; failure to finish, test, or analyze is assessed elsewhere. |

### coachability — 5%

| Rating | Anchor |
| --- | --- |
| 1 | Does not engage with feedback or use it productively. |
| 2 | Repeats a demonstrated misunderstanding or only partially incorporates feedback. |
| 3 | Understands feedback and continues productively. |
| 4 | Explains feedback implications, makes the appropriate correction, and validates recovery. |

### Attribution and evidence rules

Assistance affects the independence score only. A candidate can earn full implementation credit for a correct assisted artifact. Judge reasoning from explanations actually demonstrated after help; a low reasoning rating requires a specific unresolved explanation or incorrect claim, not failure to invent the method. Supplied-test success earns validation 3; candidate-authored diagnostic cases or meaningful traces can distinguish 4. Suggested tests do not reduce validation credit. Correct prompted or corrected complexity earns 3. Independent verifier tests establish the artifact result, not candidate testing behavior.

Do not reduce independence for not finishing, testing, or analyzing. Do not reduce coachability merely for repeated hints or confusing/incorrect interviewer advice. Leave dimensions unobserved when there was no fair opportunity. Confidence measures support for observations, not unaided mastery; it never multiplies a score.

### Candidate score

Application code computes all derived fields. Normalize each observed rating as `(rating - 1) / 3`. Compute technical T from framing/reasoning/implementation/testing/complexity with weights 5/15/25/10/5, independence I from its rating, and interaction B from communication/recovery with weights 5/5, each out of 100. Missing dimensions renormalize only within their block.

`preBoundScore = 0.60 × T + 0.30 × I + 0.10 × B`.

Require at least 42/60 technical weight, observed reasoning/implementation/independence, one observed interaction dimension, and confirmed consistent artifact evidence before ranking. Otherwise the overall score is null and observable subtotals remain visible.

| Confirmed artifact | Score bound |
| --- | --- |
| Correct optimal implementation meeting packet requirements | Minimum 55 |
| Functionally correct baseline exceeding required resource limits | Maximum 54 |
| Known incomplete, incorrect, nonterminating, non-runnable, or observed absent submission | Maximum 49 |
| Missing or contradictory artifact evidence | Pending verification, unranked |
| Organizer-confirmed unusable recording | Administrative zero, no technical rank |

Derive the band from the unrounded bounded score: 80 strong_pass, 65 pass, 50 borderline, otherwise not_demonstrated. Keep the score before the bound and its reason visible. A bound never repairs contradictory ratings: implementation 2 plus an optimal outcome must be reconciled, not automatically upgraded.

### Technical result and assistance

`technicalResult` stores separate approach (`not_observed`, `none`, `partial`, `correct_baseline`, `correct_optimal`) and final artifact (`not_observed`, `no_submission`, `incomplete`, `non_runnable`, `incorrect`, `correct_baseline`, `correct_optimal`). `no_submission` requires evidence that no artifact was produced; unavailable evidence is `not_observed`. A baseline that crashes on valid inputs is incorrect, not merely inefficient.

Verification records status (`pending`, `confirmed`, `contradicted`), exact artifact SHA-256 (null only without an artifact), runtime/harness, checks, and cited evidence. Confirm correctness against the assigned packet and actual runtime. Do not silently repair candidate code or treat reviewer-imposed harness differences as candidate faults. An optimal artifact requires implementation 4 and an optimal approach; a correct baseline requires implementation 3. Missing candidate Big-O does not contradict a reviewer-verified optimal artifact.

An `assistanceProfile` explains affected milestones using evidence. Independence 4/3/2/1 displays independent/lightly assisted/substantially assisted/interviewer-led. Keep a timestamped hint timeline with `duringAssessment`; record `assessmentEndedAtSeconds` so later editorial walkthroughs are not charged against the attempt.

Require manual review for interviewer-led work, level 3–4 disclosures during the assessed attempt, compromising integrity flags, unresolved material role attribution, inconsistent artifact evidence, insufficient core evidence, or unusable evidence. Review routing does not reduce the numeric score. Appropriate requested central help can trigger review without being misconduct.

## Decision 3: Interviewer quality

Rate each dimension from 1 to 4.

### A. Structure and setup — 15%

| Rating | Anchor |
| --- | --- |
| 1 | The session lacked a usable structure or the participant did not receive a fair opportunity to attempt the problem. |
| 2 | The session was recognizable as an interview but had avoidable confusion or missing setup. |
| 3 | The interviewer established the problem, expectations, and a workable interview flow. |
| 4 | The interviewer created a clear, realistic structure while preserving candidate ownership of the session. |

### B. Question fidelity and correctness — 15%

| Rating | Anchor |
| --- | --- |
| 1 | Gave materially incorrect information or changed the task in a way that invalidated the assessment. |
| 2 | Introduced minor inaccuracies or unnecessary ambiguity that affected progress. |
| 3 | Presented and clarified the assigned problem accurately. |
| 4 | Maintained complete fidelity while using examples and constraints precisely. |

### C. Probing and active listening — 20%

| Rating | Anchor |
| --- | --- |
| 1 | Did not engage with the candidate's reasoning or repeatedly talked past it. |
| 2 | Asked some relevant questions but missed important opportunities to probe understanding. |
| 3 | Followed the candidate's reasoning and used useful questions to test or extend it. |
| 4 | Used concise, adaptive questions that exposed assumptions and depth without supplying the answer. |

### D. Hint discipline — 30%

| Rating | Anchor |
| --- | --- |
| 1 | Revealed the central solution prematurely or led substantial portions of the implementation. |
| 2 | Gave one or more overly strong hints, skipped reasonable escalation steps, or intervened before enough independent effort. |
| 3 | Used proportionate, incremental hints after productive struggle or a direct request for help. |
| 4 | Preserved candidate ownership, used the smallest useful intervention, and escalated only when clearly warranted. |

### E. Time management — 10%

| Rating | Anchor |
| --- | --- |
| 1 | Time use prevented a meaningful assessment. |
| 2 | Important stages were rushed or the session remained stuck without an appropriate intervention. |
| 3 | Time was allocated reasonably across understanding, approach, implementation, and review. |
| 4 | The interviewer adapted pacing effectively while preserving enough evidence for assessment. |

### F. Feedback and conduct — 10%

| Rating | Anchor |
| --- | --- |
| 1 | Conduct was unprofessional, dismissive, or materially harmful to the assessment. |
| 2 | Conduct was acceptable but feedback was vague, mistimed, or minimally useful. |
| 3 | Conduct was professional and feedback was specific and constructive. |
| 4 | The interviewer maintained a realistic, supportive environment and gave concise, actionable feedback. |

Calculate the interviewer score with the same normalized formula used for the candidate score.

| Score | AI recommendation |
| --- | --- |
| 80–100 | `strong` |
| 65–79 | `effective` |
| 50–64 | `coaching_recommended` |
| 0–49 | `organizer_follow_up` |

Any critical interviewer flag requires organizer review regardless of the numeric score.

## Hint analysis

Identify every material interviewer intervention and classify it:

| Level | Description | Examples |
| --- | --- | --- |
| 0 | No solution help | Administrative direction or neutral encouragement |
| 1 | Clarification | Restating the prompt, confirming an assumption, or correcting a misunderstanding already answered by the statement |
| 2 | Directional nudge | Asking a focused question or pointing toward an overlooked constraint without naming the core technique |
| 3 | Core technique disclosure | Naming or effectively revealing the central data structure, algorithm, recurrence, state, invariant, or key transformation |
| 4 | Solution leadership | Providing the transition, implementation steps, code structure, debugging sequence, or answer in a way that leaves little design work to the candidate |

For each intervention, record:

- timestamp;
- transcript excerpt;
- hint level;
- whether the candidate requested help;
- what the candidate had already demonstrated;
- whether the intervention matched the next step in the official hint ladder;
- whether a smaller intervention was reasonably available;
- the milestone the candidate reached afterward.

Do not judge hint quality by count alone. Consider timing, candidate progress, whether the interviewer waited for productive struggle, whether hints escalated one step at a time, and whether the candidate was given an opportunity to use each hint.

### Avoiding double penalties

- Session completion records whether a genuine interview occurred; it is not reduced merely because hints were given.
- Solution outcome records the final technical milestone regardless of assistance.
- Candidate independence records how much of that milestone was reached independently.
- Interviewer hint discipline records whether the assistance was appropriate.
- Evidence confidence describes how well observations are supported. Heavy assistance can be confidently observed; uncertainty about unaided mastery belongs in the assistance profile and organizer checks, not a score multiplier.

## AI recap requirements

The collapsed AI review panel should contain:

1. A concise recap of the interview.
2. The session-completion recommendation and evidence.
3. Candidate dimension ratings, score, readiness recommendation, and confidence.
4. The solution-outcome milestone.
5. Interviewer dimension ratings, score, and any coaching recommendation.
6. A timestamped hint timeline.
7. Three to six key moments with seekable timestamps.
8. Contradictions between the recording, transcript, submitted code, and reports.
9. Transcript, speaker-attribution, and overall evaluation confidence.
10. Specific questions or checks for the organizer, if needed.

The accordion is collapsed by default. Its closed header may show processing state (`queued`, `transcribing`, `evaluating`, `ready`, or `failed`) but must not expose a score before the organizer opens it.

## Structured evaluator output

The stored, server-calculated evaluation uses `aiReviewV4Schema` in `src/services/review-rubric-v4.ts`. New grading subagents receive only [the reviewer criteria](./ROUND_3_REVIEWER_CRITERIA.md) and return `reviewV4ObservationsSchema` from `src/services/review-observations.ts`; they do not receive this organizer policy document, weights, aggregate score fields, thresholds or calibration targets. Primary and independent verification observations are completed before the server applies its scoring policy. It retains role attribution, completion, interviewer dimensions, evidence, timelines, key moments, contradictions, and confidence from v3. Candidate dimensions now separate `testing` and `complexity`; the candidate also supplies `technicalResult` and `assistanceProfile`. Every hint supplies `duringAssessment`, and the review supplies `assessmentEndedAtSeconds`. Application code derives score components, solution summary, band, assistance label, and review workflow.

Historical v3 artifacts and the automatic v3 draft evaluator remain explicitly versioned under [the archived v3 rubric](./ROUND_3_AI_REVIEW_RUBRIC_V3.md) until their own evaluation runs migrate. Do not relabel old ratings. The current v4 local audit uses Astra Max with Fast mode off.

## Calibration before use

Before the AI recommendation influences advancement or referral review:

1. Two organizers should independently apply this rubric to a representative sample of recordings.
2. Resolve disagreements and revise ambiguous anchors.
3. Run the evaluator without showing its output to the human reviewers.
4. Compare per-dimension agreement, not only the total score.
5. Review every case where the AI and organizers disagree on completion, passing band, independence, or hint discipline.
6. Version any rubric or prompt change and retain the original result for auditability.

The first production release should require human confirmation for every outcome and should not automatically message participants about AI-generated findings.

## Processing contract

Recording analysis should begin automatically after a direct recording upload is finalized.

1. The WTA Worker creates a durable analysis job referencing the private R2 recording object.
2. The Olares GPU service receives or polls for the job through a narrowly authenticated Cloudflare Tunnel endpoint.
3. The service fetches the recording with a short-lived credential, extracts audio, and runs quality-first transcription plus speaker diarization.
4. The service returns timestamped transcript JSON and WebVTT captions; the WTA Worker writes the artifacts to private R2 and updates job state in D1.
5. A single evaluator agent receives the transcript, rubric version, problem packet, submitted code, and reports, then returns schema-validated review JSON.
6. The WTA Worker stores the AI review separately from the human rubric and marks the accordion `ready`.

Do not expose R2 credentials to the GPU service or make participant recordings publicly addressable. Authenticate both directions, use idempotent job identifiers, lease jobs to prevent duplicate processing, retain model and prompt versions, and make retries safe.
