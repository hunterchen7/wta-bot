import type { ProblemRow } from '../admin-types';

export type NewProblem = Omit<ProblemRow, 'id' | 'uses' | 'exposures'>;
export type EditableProblem = ProblemRow | NewProblem;

export function createBlankProblem(): NewProblem {
  return {
    source: 'manual',
    number: null,
    title: '',
    url: null,
    difficulty: 'medium',
    difficulty_rank: 2,
    content_md: '',
    available_weeks: [2],
    statement_md: '',
    interviewer_notes_md: '',
    hints_md: null,
    solution_md: null,
    execution: { mode: 'manual' },
    active: 1,
  };
}
