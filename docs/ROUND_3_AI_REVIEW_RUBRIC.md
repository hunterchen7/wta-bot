# Round 3 Recording Review Rubric

> **Status:** Draft for organizer calibration  
> **Rubric version:** `round3-review-v3`  
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

### A. Problem framing and clarification — 10%

| Rating | Anchor |
| --- | --- |
| 1 | Misunderstood the task or important constraints and did not recover. |
| 2 | Understood the basic task but missed relevant constraints, examples, or edge conditions without prompting. |
| 3 | Correctly framed the task and asked or answered useful clarifying questions. |
| 4 | Established a precise model of the task, surfaced important assumptions, and used examples or constraints to guide the solution. |

### B. Approach and reasoning — 20%

| Rating | Anchor |
| --- | --- |
| 1 | Did not produce a coherent approach or repeatedly relied on unsupported guesses. |
| 2 | Produced partial ideas or a plausible naive approach but could not justify or develop it without substantial guidance. |
| 3 | Developed a correct approach with understandable reasoning and recognized the important trade-offs. |
| 4 | Reasoned systematically, justified invariants or design choices, compared alternatives, and adapted the approach when evidence changed. |

### C. Implementation — 20%

| Rating | Anchor |
| --- | --- |
| 1 | Produced little relevant code or code that did not reflect a viable approach. |
| 2 | Implemented meaningful portions but left major correctness gaps or required substantial implementation guidance. |
| 3 | Produced a mostly correct implementation with only localized mistakes or minor unfinished work. |
| 4 | Produced a correct, coherent implementation and debugged issues methodically. |

### D. Testing and complexity — 15%

| Rating | Anchor |
| --- | --- |
| 1 | Did not test meaningfully and could not explain the relevant complexity. |
| 2 | Checked basic examples or attempted complexity analysis, but missed important cases or made material errors. |
| 3 | Tested representative and edge cases and gave substantially correct time and space complexity. |
| 4 | Used tests to validate assumptions, found subtle failure modes, and precisely justified time and space complexity. |

### E. Technical communication — 10%

| Rating | Anchor |
| --- | --- |
| 1 | The technical approach could not be followed because key reasoning remained unexplained. |
| 2 | Communicated intermittently but left important decisions or changes unexplained. |
| 3 | Communicated the approach, implementation, and corrections clearly enough to follow. |
| 4 | Communicated a concise, structured chain of reasoning and made assumptions, trade-offs, and corrections explicit. |

### F. Independence — 15%

| Rating | Anchor |
| --- | --- |
| 1 | The interviewer supplied the central approach or led the implementation step by step. |
| 2 | Reached major milestones only after one or more core algorithmic or implementation disclosures. |
| 3 | Drove the solution with only clarification or limited directional hints. |
| 4 | Independently framed, developed, implemented, and evaluated the solution. |

### G. Coachability and recovery — 10%

| Rating | Anchor |
| --- | --- |
| 1 | Did not meaningfully engage with feedback or could not use it to make progress. |
| 2 | Used feedback inconsistently or required the same issue to be explained repeatedly. |
| 3 | Incorporated feedback, corrected course, and continued productively. |
| 4 | Diagnosed the implication of feedback, explained the correction, and validated the revised approach. |

### Candidate score

Application code—not the evaluator—calculates the score and band. For observed dimensions:

```text
observed weight = sum(weight)
numerator = sum(weight × (rating - 1))
raw score = 100 × numerator / (3 × observed weight)
```

If there are no observed dimensions, the score is `null`. Derive the recommendation from the unrounded raw score, then round only the displayed score. Model-authored scores and recommendation labels are ignored.

The score is supporting evidence, not the final decision.

| Score | AI recommendation |
| --- | --- |
| 80–100 | `strong_pass` — strong evidence for alumni-interview or referral readiness |
| 65–79 | `pass` — sufficient evidence for advancement |
| 50–64 | `borderline` — organizer judgment and additional evidence required |
| 0–49 | `not_demonstrated` — readiness was not demonstrated in this session |

The application retains the numeric band but requires manual review when independence is rated 1, a structured integrity flag says interviewer conduct materially compromised candidate evidence, less than 70% of the rubric weight was observed, or reasoning, implementation, or independence was not observed.

Passing does not itself create a referral. Organizers retain discretion based on the complete program record and available opportunities.

## Solution outcome

Record the highest milestone demonstrated, separately from the weighted candidate score:

1. `no_viable_approach`
2. `partial_insight`
3. `correct_naive_described`
4. `correct_naive_implemented_or_optimal_described`
5. `optimal_mostly_implemented`
6. `optimal_implemented_tested_and_analyzed`

This captures what was accomplished. Independence captures how much of it was accomplished without interviewer assistance.

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
- AI confidence is reduced when heavy interviewer guidance makes candidate mastery difficult to infer.

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

The evaluator should return validated JSON shaped approximately as follows:

```json
{
  "rubricVersion": "round3-review-v3",
  "roleAttribution": {
    "resolution": "confirmed | partial | unresolved",
    "interviewer": { "participantId": 0, "name": "string", "evidence": [] },
    "interviewee": { "participantId": 0, "name": "string", "evidence": [] },
    "turns": [{ "startSeconds": 0, "endSeconds": 0, "role": "interviewer | interviewee | unknown", "confidence": 0.0 }],
    "rationale": "string"
  },
  "recap": "string",
  "sessionCompletion": {
    "recommendation": "completed | incomplete | unreviewable",
    "rationale": "string",
    "evidence": [{ "startSeconds": 0, "endSeconds": 0, "note": "string", "scope": "session" }]
  },
  "candidate": {
    "dimensions": {
      "problemFraming": { "rating": 1, "confidence": 0.0, "evidence": [] },
      "reasoning": { "rating": 1, "confidence": 0.0, "evidence": [] },
      "implementation": { "rating": 1, "confidence": 0.0, "evidence": [] },
      "testingAndComplexity": { "rating": 1, "confidence": 0.0, "evidence": [] },
      "communication": { "rating": 1, "confidence": 0.0, "evidence": [] },
      "independence": { "rating": 1, "confidence": 0.0, "evidence": [] },
      "coachability": { "rating": 1, "confidence": 0.0, "evidence": [] }
    },
    "score": 0,
    "scoreBand": "strong_pass | pass | borderline | not_demonstrated",
    "readiness": "strong_pass | pass | borderline | not_demonstrated | manual_review",
    "requiresManualReview": false,
    "manualReviewReasons": [],
    "solutionOutcome": "no_viable_approach",
    "rationale": "string"
  },
  "interviewer": {
    "dimensions": {
      "structure": { "rating": 1, "confidence": 0.0, "evidence": [] },
      "questionFidelity": { "rating": 1, "confidence": 0.0, "evidence": [] },
      "probing": { "rating": 1, "confidence": 0.0, "evidence": [] },
      "hintDiscipline": { "rating": 1, "confidence": 0.0, "evidence": [] },
      "timeManagement": { "rating": 1, "confidence": 0.0, "evidence": [] },
      "feedbackAndConduct": { "rating": 1, "confidence": 0.0, "evidence": [] }
    },
    "score": 0,
    "recommendation": "strong | effective | coaching_recommended | organizer_follow_up",
    "requiresOrganizerReview": false,
    "criticalFlags": []
  },
  "phaseTimeline": [],
  "hints": [],
  "keyMoments": [],
  "contradictions": [],
  "confidence": {
    "transcript": 0.0,
    "speakerAttribution": 0.0,
    "overall": 0.0
  },
  "organizerChecks": []
}
```

In the production schema, a dimension rating must also permit `null` when its status is `not_observed`.

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
