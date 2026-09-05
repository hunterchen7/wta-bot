# Round 3 Local Subagent Review Contract

> **Input version:** `wta-local-review-v2`
> **Rubric version:** `round3-review-v4`
> **Reviewer:** Codex built-in subagent using `gpt-6-astra` with reasoning effort `max`
>
> **Service tier:** `default` (Fast mode off)

This is the authoritative procedure for a locally verified Round 3 recording review. It is separate from the automatic hosted draft evaluator. A local review is advisory until an organizer confirms it.

## Reviewer configuration

- Use the built-in Codex subagent tool. Do not send the recording, transcript, reports, or participant data to web search or an unrelated external service.
- Run the primary review with `gpt-6-astra` and reasoning effort `max`.
- Run a separate adversarial verification subagent with the same `gpt-6-astra` model and `max` reasoning effort. It must try to disprove the primary review by checking timestamps, speaker roles, arithmetic, rubric anchors, contradictory evidence, and whether assistance compromised the assessment.
- Keep Fast mode off for both passes: use service tier `default`, with no `fast` or `priority` override. If the subagent launcher inherits the tier, verify the effective inherited setting before grading.
- This model selection applies to new local review runs. Preserve the original model, reasoning effort, and rubric version on existing review artifacts.
- Resolve disagreements explicitly. Do not silently average two judgments.

## Required input bundle

Every review receives the same fields. Missing fields remain explicit; they are never collapsed into an empty object.

```json
{
  "inputVersion": "wta-local-review-v2",
  "rubricVersion": "round3-review-v4",
  "session": {
    "sessionId": 0,
    "round": 3,
    "scheduledAt": "ISO-8601 or null",
    "recordingDurationSeconds": 0,
    "interviewer": { "participantId": 0, "name": "string" },
    "interviewee": { "participantId": 0, "name": "string" }
  },
  "problem": {
    "number": "string",
    "title": "string",
    "difficulty": "string",
    "statement": "markdown",
    "interviewerNotes": "markdown",
    "hintLadder": "markdown",
    "solution": "markdown"
  },
  "reports": [
    {
      "kind": "interviewer_report | interviewee_report",
      "state": "submitted | not_submitted | invalid",
      "submittedAt": "ISO-8601 or null",
      "answers": {}
    }
  ],
  "submittedCode": {
    "state": "submitted | not_submitted | invalid",
    "language": "string or null",
    "source": "string or null"
  },
  "transcript": {
    "version": "wta-transcript-v1",
    "durationSeconds": 0,
    "transcriptConfidence": 0,
    "speakerConfidence": 0,
    "transcriptionModel": "string",
    "diarizationModel": "string",
    "segments": []
  }
}
```

The transcript must be complete and timestamped. The reviewer must read all segments, not a summary or selected excerpts.

## Required review sequence

1. Establish speaker roles before reviewing performance. Copy the assigned names and participant IDs from session metadata, then use conversational evidence to label every transcript segment `interviewer`, `interviewee`, or `unknown`. The recording uploader is context, not automatic speaker proof. Persist the full role mapping, its evidence, and confidence. Record uncertainty instead of guessing.
2. Build a phase timeline for the full usable recording: setup, clarification, approach, implementation, testing, complexity, feedback, downtime, and wrap-up.
3. Build the interviewer-intervention timeline and classify each material hint from level 0 through level 4.
4. For every rubric dimension, identify the opportunity to demonstrate it, representative supporting evidence, material counterevidence, and limitations.
5. Determine session completion, candidate evidence, session technical outcome, and interviewer quality independently.
6. Read both submitted reports as role-attributed secondary evidence. Identify agreements and contradictions among the transcript, submitted code, reports, and official packet. Never transfer an answer from one report's author to the other role.
7. Run the adversarial verification pass before publishing the result.

## Evidence contract

Each evidence item has one scope:

- `moment`: a local exchange or action;
- `interval`: a meaningful phase or sustained behaviour;
- `session`: a conclusion supported by the full-session timeline;
- `report`: contextual evidence from a submitted report;
- `code`: evidence from the submitted artifact.

Completion and time management are longitudinal judgments. They must cite the opening, stopping point, and relevant phase or session ranges. A single timestamp or opening exchange cannot support a time-management rating.

An observed dimension requires an integer rating from 1 through 4 and at least one valid evidence item. A `not_observed` dimension requires `rating: null`. Absence of an opportunity is not evidence for rating 1.

If an organizer has confirmed that a missing, silent, corrupt, or materially truncated recording is unusable, return `sessionCompletion.recommendation: "unreviewable"`, leave unsupported dimensions and the solution outcome `not_observed`, and set `evidenceDisposition` to `{"status":"unusable","administrativeScore":0,"reason":"concrete defect"}`. The resulting zero is administrative and must not be described as observed candidate or interviewer performance.

## Deterministic calculations

The reviewer supplies atomic ratings and evidence. Application code computes the score, score band, manual-review state, and organizer-review state. Reviewer-authored values for these derived fields are ignored.

Use the block formula, artifact bounds, evidence requirements, and anchors in [ROUND_3_AI_REVIEW_RUBRIC.md](./ROUND_3_AI_REVIEW_RUBRIC.md) and the validated `aiReviewV4Schema` in `src/services/review-rubric-v4.ts`. Candidate testing and complexity are separate ratings. Assistance affects independence only; central disclosures still trigger manual review without changing the technical result.

The application computes technical, independence, and interaction subtotals; the 60/30/10 composite; result floor/caps; score band; and review routing. Missing or inconsistent core evidence remains unranked. Administrative zero is separate from technical performance.

## Immutable audit batches

Each audit batch freezes its session/job membership and exact rubric, input, model, effort, and service tier. New primary, verification, and resolved results use unique run artifact paths. Never overwrite an old evaluation or role-labeled transcript. Keep the prior active cohort result set until the complete new batch has passed verification and organizer calibration; then activate it atomically through the cohort's active-batch pointer. Missing v4 results must not silently fall back to v3 in a v4 leaderboard.

Storage uses `review_audit_batches` and `review_evaluation_runs`, added by migration `0036_versioned_review_audits.sql`. The existing `review_analysis_jobs` table continues to own recording and transcription work. A run references its original job and an SHA-256 digest of the frozen input bundle; its provenance records the private input location and hashes of the rubric and schema.

Run states are `queued`, `reviewing`, `verifying`, `ready`, and `failed`. Only mark a run `ready` after the separate verifier has finished and material disagreements have been resolved. Store the primary output, verification notes, resolved evaluation, and a separate role-labeled transcript before recording their object keys. Preserve both passes' actual model, effort, tier, timestamps, and input/output hashes in `provenance_json`. Artifact paths should contain the batch and run IDs. Completed rows cannot be changed or deleted; retries create a higher attempt number.

A batch can become `verified` only when the latest attempt for every frozen job is `ready`. Verification is a workflow milestone, not human approval of a candidate's performance: manual-review flags remain on the result. After organizer calibration, `activateReviewAuditBatch` selects the whole batch transactionally. Activating a previous verified batch rolls back that selection. The review reader uses the selected batch's rubric-specific normalizer and artifacts. With no active batch, it continues to show the original job evaluations and preserves their stored rubric versions.

Keep private audit packets out of Git. A local checkpoint can live under the ignored `.wrangler/audits/<batch-id>/` directory. Preserve the input manifest and frozen rubric with the results so work can resume after a session ends. A local checkpoint is not a published or activated evaluation.

## Integrity flags

Unauthorized candidate AI use, solution disclosure, interviewer-led implementation, wrong-problem use, material factual errors, denial of an assessment opportunity, and harmful conduct must use structured, timestamped flags. The flag states whether it compromises candidate evidence.

An interviewer may privately use external tools, including AI, to inspect or verify candidate code. The tool use itself is not misconduct and does not compromise candidate evidence. Review the help actually communicated to the candidate under the ordinary probing, hint-discipline, and independence criteria. Flag external AI only when the candidate uses it without authorization, or when the interviewer directly supplies an externally generated solution in a way already covered by solution-disclosure or implementation-led flags.

## Provenance and retention

Store the exact rubric version, input version, reviewer model, reasoning effort, effective service tier, evaluation timestamp, primary result, and verification notes for both passes. The dashboard must identify a locally verified review distinctly from an automatic draft. Do not message participants or change completion, eligibility, or referral decisions from the subagent result alone.
