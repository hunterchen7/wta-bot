# Round 3 Local Subagent Review Contract

> **Input version:** `wta-local-review-v1`  
> **Rubric version:** `round3-review-v3`  
> **Reviewer:** Codex built-in subagent using `gpt-5.6-sol` with reasoning effort `ultra`

This is the authoritative procedure for a locally verified Round 3 recording review. It is separate from the automatic hosted draft evaluator. A local review is advisory until an organizer confirms it.

## Reviewer configuration

- Use the built-in Codex subagent tool. Do not send the recording, transcript, reports, or participant data to web search or an unrelated external service.
- Run the primary review with `gpt-5.6-sol` and reasoning effort `ultra`.
- Run a second adversarial pass that tries to disprove the primary review. It must check timestamps, speaker roles, arithmetic, rubric anchors, contradictory evidence, and whether assistance compromised the assessment.
- Resolve disagreements explicitly. Do not silently average two judgments.

## Required input bundle

Every review receives the same fields. Missing fields remain explicit; they are never collapsed into an empty object.

```json
{
  "inputVersion": "wta-local-review-v1",
  "rubricVersion": "round3-review-v3",
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

For observed dimensions:

```text
observed weight = sum(weight)
numerator = sum(weight × (rating - 1))
raw score = 100 × numerator / (3 × observed weight)
```

If no dimension is observed, the score is `null`. The application derives the band from the unrounded raw score and rounds only the displayed score.

A candidate review requires manual review when evidence coverage is insufficient, a core dimension is missing, independence is rated 1, or a structured integrity flag says that interviewer conduct compromised candidate evidence. Numeric score and score band remain visible so the workflow override does not erase the underlying assessment.

## Integrity flags

Unauthorized candidate AI use, solution disclosure, interviewer-led implementation, wrong-problem use, material factual errors, denial of an assessment opportunity, and harmful conduct must use structured, timestamped flags. The flag states whether it compromises candidate evidence.

An interviewer may privately use external tools, including AI, to inspect or verify candidate code. The tool use itself is not misconduct and does not compromise candidate evidence. Review the help actually communicated to the candidate under the ordinary probing, hint-discipline, and independence criteria. Flag external AI only when the candidate uses it without authorization, or when the interviewer directly supplies an externally generated solution in a way already covered by solution-disclosure or implementation-led flags.

## Provenance and retention

Store the exact rubric version, input version, reviewer model, reasoning effort, evaluation timestamp, primary result, and verification notes. The dashboard must identify a locally verified review distinctly from an automatic draft. Do not message participants or change completion, eligibility, or referral decisions from the subagent result alone.
