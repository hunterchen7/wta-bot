import { getExecutableProblem } from './pairy-executable-problems';
import {
  composeQuestionMarkdown,
  normalizeAvailableWeeks,
  parseQuestionMarkdown,
} from './question-markdown';

export const PROBLEM_LANGUAGES = ['python', 'javascript', 'typescript', 'java', 'cpp'] as const;
export type ProblemLanguage = typeof PROBLEM_LANGUAGES[number];

export type ProblemTestCase = {
  description: string;
  input: string;
  expectedOutput: string;
  isHidden: boolean;
};

export type ProblemExecution =
  | { mode: 'manual' }
  | {
    mode: 'stdin_tests';
    languages: ProblemLanguage[];
    starterCode: Partial<Record<ProblemLanguage, string>>;
    testCases: ProblemTestCase[];
  };

export type ProblemStorageRow = {
  source?: string | null;
  number?: number | null;
  hints_md?: string | null;
  solution_md?: string | null;
  interviewer_notes_md?: string | null;
  execution_json?: string | null;
};

export type NormalizedProblemInput = {
  source: string;
  number: number | null;
  title: string;
  url: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  difficultyRank: number | null;
  content: string;
  availableWeeks: number[];
  statement: string;
  interviewerNotes: string;
  execution: ProblemExecution;
  executionJson: string;
  active: 0 | 1;
};

/** Normalize dashboard, Admin API, and MCP writes through one contract. */
export function normalizeProblemInput(body: unknown): NormalizedProblemInput | null {
  if (!isRecord(body)) return null;
  const title = text(body.title, 200);
  if (!title || !['easy', 'medium', 'hard'].includes(String(body.difficulty))) return null;

  const availableWeeks = normalizeAvailableWeeks(body.availableWeeks ?? body.availableRounds);
  if (!availableWeeks.length) return null;

  const legacyContent = typeof body.content === 'string' ? body.content.slice(0, 100_000) : '';
  const legacySections = legacyContent ? parseQuestionMarkdown(legacyContent) : null;
  const statement = text(body.statementMarkdown ?? body.statement ?? legacySections?.statement, 100_000);
  if (!statement) return null;

  const interviewerNotes = text(
    body.interviewerNotesMarkdown
      ?? body.interviewerNotes
      ?? combineLegacyNotes(legacySections?.hints, legacySections?.solution),
    100_000,
  );
  const execution = normalizeProblemExecution(body.execution ?? { mode: 'manual' });
  if (!execution) return null;
  const rawRank = body.difficultyRank == null ? null : Number(body.difficultyRank);
  const rawNumber = body.number == null || body.number === '' ? null : Number(body.number);

  return {
    source: text(body.source ?? 'manual', 50) || 'manual',
    number: rawNumber != null && Number.isInteger(rawNumber) && rawNumber > 0 ? rawNumber : null,
    title,
    url: text(body.url, 1_000) || null,
    difficulty: body.difficulty as 'easy' | 'medium' | 'hard',
    difficultyRank: rawRank != null && Number.isFinite(rawRank) ? rawRank : null,
    content: composeQuestionMarkdown({ statement, hints: interviewerNotes, solution: '' }).slice(0, 100_000),
    availableWeeks,
    statement,
    interviewerNotes,
    execution,
    executionJson: JSON.stringify(execution),
    active: body.active === false || body.active === 0 ? 0 : 1,
  };
}

export function normalizeProblemExecution(value: unknown): ProblemExecution | null {
  if (!isRecord(value)) return null;
  if (value.mode === 'manual') return { mode: 'manual' };
  if (value.mode !== 'stdin_tests' || !Array.isArray(value.languages) || !isRecord(value.starterCode) || !Array.isArray(value.testCases)) return null;

  const languages = [...new Set(value.languages)]
    .filter((language): language is ProblemLanguage => typeof language === 'string' && PROBLEM_LANGUAGES.includes(language as ProblemLanguage));
  if (!languages.length || languages.length !== value.languages.length || languages.length > PROBLEM_LANGUAGES.length) return null;

  const starterCode: Partial<Record<ProblemLanguage, string>> = {};
  for (const language of languages) {
    const code = text(value.starterCode[language], 100_000, false);
    if (!code.trim()) return null;
    starterCode[language] = code;
  }
  if (!value.testCases.length || value.testCases.length > 100) return null;
  const testCases: ProblemTestCase[] = [];
  for (const item of value.testCases) {
    if (!isRecord(item)) return null;
    const description = text(item.description, 200);
    const input = text(item.input, 50_000, false);
    const expectedOutput = text(item.expectedOutput, 50_000, false);
    if (!description || input == null || expectedOutput == null) return null;
    testCases.push({ description, input, expectedOutput, isHidden: item.isHidden === true });
  }
  return { mode: 'stdin_tests', languages, starterCode, testCases };
}

/** Read the stored definition, falling back to the shipped legacy WTA specs. */
export function effectiveProblemExecution(problem: ProblemStorageRow): ProblemExecution {
  if (problem.execution_json) {
    try {
      const stored = normalizeProblemExecution(JSON.parse(problem.execution_json));
      if (stored) return stored;
    } catch {
      // A malformed optional definition should not break interviewer packets.
    }
  }
  const executable = problem.source?.trim().toLowerCase() === 'leetcode'
    ? getExecutableProblem(problem.number ?? null)
    : null;
  return executable ? { mode: 'stdin_tests', ...executable } : { mode: 'manual' };
}

export function effectiveInterviewerNotes(problem: ProblemStorageRow): string {
  return problem.interviewer_notes_md != null
    ? problem.interviewer_notes_md.trim()
    : combineLegacyNotes(problem.hints_md, problem.solution_md);
}

export function combineLegacyNotes(hints: unknown, solution: unknown): string {
  const cleanHints = text(hints, 100_000);
  const cleanSolution = text(solution, 100_000);
  if (cleanHints && cleanSolution) return `${cleanHints}\n\n## Intended solution\n\n${cleanSolution}`;
  if (cleanHints) return cleanHints;
  return cleanSolution ? `## Intended solution\n\n${cleanSolution}` : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number, trim = true): string {
  if (value == null) return '';
  const result = String(value).slice(0, max);
  return trim ? result.trim() : result;
}
