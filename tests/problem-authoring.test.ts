import { describe, expect, it } from 'vitest';
import {
  effectiveInterviewerNotes,
  effectiveProblemExecution,
  normalizeProblemInput,
} from '../src/problem-authoring';

describe('portable problem authoring', () => {
  it('normalizes structured dashboard and MCP inputs through one contract', () => {
    const problem = normalizeProblemInput({
      title: 'Echo',
      difficulty: 'easy',
      availableRounds: [2, 1, 2],
      statementMarkdown: 'Echo standard input.',
      interviewerNotesMarkdown: 'Watch for whitespace.',
      execution: {
        mode: 'stdin_tests',
        languages: ['python'],
        starterCode: { python: 'print(input())' },
        testCases: [{ description: 'line', input: 'hello', expectedOutput: 'hello', isHidden: false }],
      },
    });

    expect(problem).toMatchObject({
      availableWeeks: [1, 2],
      statement: 'Echo standard input.',
      interviewerNotes: 'Watch for whitespace.',
      execution: { mode: 'stdin_tests', languages: ['python'] },
    });
    expect(JSON.parse(problem!.executionJson)).toEqual(problem!.execution);
  });

  it('keeps the legacy Markdown API compatible while merging private notes', () => {
    const problem = normalizeProblemInput({
      title: 'Legacy',
      difficulty: 'medium',
      availableWeeks: [2],
      content: '## Statement\n\nSolve it.\n\n## Hints\n\nStart small.\n\n## Solution\n\nSweep once.',
    });
    expect(problem).toMatchObject({
      statement: 'Solve it.',
      interviewerNotes: 'Start small.\n\n## Intended solution\n\nSweep once.',
      execution: { mode: 'manual' },
    });
  });

  it('rejects executable definitions without starter code for every language', () => {
    expect(normalizeProblemInput({
      title: 'Incomplete',
      difficulty: 'medium',
      availableWeeks: [2],
      statementMarkdown: 'Solve it.',
      execution: {
        mode: 'stdin_tests',
        languages: ['python', 'java'],
        starterCode: { python: 'print(input())' },
        testCases: [{ description: 'case', input: '', expectedOutput: '', isHidden: false }],
      },
    })).toBeNull();
  });

  it('hydrates legacy rows from neutral executable specs and merged notes', () => {
    const row = {
      source: 'leetcode',
      number: 3,
      hints_md: 'Use a sliding window.',
      solution_md: 'Track last-seen positions.',
      interviewer_notes_md: null,
      execution_json: null,
    };
    expect(effectiveProblemExecution(row)).toMatchObject({ mode: 'stdin_tests', languages: ['python'] });
    expect(effectiveInterviewerNotes(row)).toBe('Use a sliding window.\n\n## Intended solution\n\nTrack last-seen positions.');
  });
});
