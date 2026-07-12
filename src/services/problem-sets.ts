import type { Env } from '../env';
import { generateWeekSet } from '../engine/problems';
import { activeCohort, cohortWeeks } from '../engine/weeks';
import { composeQuestionMarkdown, readAvailableWeeks } from '../question-markdown';

export class ProblemSetError extends Error {
  constructor(message: string, readonly status: 400 | 404 = 400) { super(message); }
}

export async function problemBankWorkspace(env: Env) {
  const cohort = await activeCohort(env);
  const weeks = cohort ? await cohortWeeks(env, cohort.id) : [];
  const [problems, sets] = await Promise.all([
    env.DB.prepare(
      `SELECT p.*, (SELECT count(*) FROM sessions s WHERE s.problem_id = p.id) AS uses,
              (SELECT count(*) FROM exposures e WHERE e.problem_id = p.id) AS exposures
       FROM problems p ORDER BY p.active DESC, p.difficulty_rank, lower(p.title)`,
    ).all<any>(),
    cohort ? env.DB.prepare(
      `SELECT wps.week_id, w.idx AS round, c.name AS cohort_name, p.id AS problem_id, p.title
       FROM week_problem_sets wps JOIN weeks w ON w.id = wps.week_id JOIN cohorts c ON c.id = w.cohort_id
       JOIN problems p ON p.id = wps.problem_id WHERE c.id = ?1 ORDER BY w.idx, p.title`,
    ).bind(cohort.id).all<any>() : Promise.resolve({ results: [] as any[] }),
  ]);
  return {
    problems: problems.results.map((problem: any) => ({
      ...problem,
      content_md: problem.content_md || composeQuestionMarkdown({
        statement: problem.statement_md,
        hints: problem.hints_md,
        solution: problem.solution_md,
      }),
      available_weeks: readAvailableWeeks(problem.available_weeks),
    })),
    sets: sets.results,
    cohort,
    weeks,
  };
}

async function requireActiveWeek(env: Env, weekId: number) {
  const week = await env.DB.prepare(
    `SELECT w.* FROM weeks w JOIN cohorts c ON c.id = w.cohort_id WHERE w.id = ?1 AND c.status = 'active'`,
  ).bind(weekId).first<any>();
  if (!week) throw new ProblemSetError('Round not found in the active cohort.', 404);
  return week;
}

export async function replaceProblemSet(env: Env, weekId: number, requestedIds: number[]) {
  const week = await requireActiveWeek(env, weekId);
  const problemIds = [...new Set(requestedIds.filter(Number.isInteger))].slice(0, 25);
  if (problemIds.length !== requestedIds.length) throw new ProblemSetError('Problem IDs must be unique integers (maximum 25).');
  if (problemIds.length) {
    const placeholders = problemIds.map((_, index) => `?${index + 1}`).join(',');
    const rows = await env.DB.prepare(
      `SELECT id, available_weeks FROM problems WHERE active = 1 AND id IN (${placeholders})`,
    ).bind(...problemIds).all<{ id: number; available_weeks: string }>();
    if (rows.results.length !== problemIds.length) throw new ProblemSetError('Every selected question must exist and be active.');
    if (rows.results.some((problem) => !readAvailableWeeks(problem.available_weeks).includes(week.idx))) {
      throw new ProblemSetError(`Every selected question must be tagged for round ${week.idx}.`);
    }
  }
  const insert = env.DB.prepare('INSERT INTO week_problem_sets (week_id, problem_id) VALUES (?1, ?2)');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM week_problem_sets WHERE week_id = ?1').bind(weekId),
    ...problemIds.map((problemId) => insert.bind(weekId, problemId)),
  ]);
  return { weekId, problemIds };
}

export async function generateProblemSet(env: Env, weekId: number, size: number) {
  const week = await requireActiveWeek(env, weekId);
  if (!Number.isInteger(size) || size < 1 || size > 20) throw new ProblemSetError('Set size must be between 1 and 20.');
  return { weekId, ...(await generateWeekSet(env, weekId, week.idx, size)) };
}
