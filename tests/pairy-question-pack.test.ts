import { describe, expect, it } from 'vitest';
import {
  createPairyQuestionPack,
  pairyQuestionPackFilename,
  type WtaPairyQuestionInput,
} from '../src/pairy-question-pack';
import {
  getPairyExecutableProblem,
  PAIRY_EXECUTABLE_SOURCE_NUMBERS,
} from '../src/pairy-executable-problems';

const problem: WtaPairyQuestionInput = {
  portableId: '019f6d13e39a71009ab220bed566f322',
  title: 'Merge Intervals',
  difficulty: 'medium',
  promptMarkdown: 'Merge every overlapping interval.',
  hintsMarkdown: 'Sort by start time.',
  solutionMarkdown: 'Sort, then sweep once.',
  source: 'leetcode',
  sourceNumber: 56,
  sourceUrl: 'https://leetcode.com/problems/merge-intervals/',
  availableRounds: [3, 2, 3],
};

describe('Pairy question packs', () => {
  it('builds a versioned, assigned-private manual question pack', async () => {
    const pack = await createPairyQuestionPack(problem);

    expect(pack).toMatchObject({
      kind: 'pairy.question-pack',
      schemaVersion: 1,
      pack: {
        id: `wta:${problem.portableId}`,
        title: 'Merge Intervals',
        access: 'assigned-private',
        revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      questions: [{
        origin: {
          namespace: 'wta-bot',
          key: problem.portableId,
          revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
        promptMarkdown: 'Merge every overlapping interval.',
        interviewer: {
          hintsMarkdown: 'Sort by start time.',
          solutionMarkdown: 'Sort, then sweep once.',
        },
        execution: { mode: 'manual' },
        source: {
          provider: 'leetcode',
          externalId: '56',
          url: problem.sourceUrl,
        },
        extensions: { wta: { availableRounds: [2, 3] } },
      }],
    });
    expect(pack.questions[0]!.origin.revision).toBe(pack.pack.revision);
  });

  it('uses a deterministic content revision and changes it with the question', async () => {
    const first = await createPairyQuestionPack(problem);
    const same = await createPairyQuestionPack({ ...problem, availableRounds: [2, 3] });
    const changed = await createPairyQuestionPack({ ...problem, solutionMarkdown: 'A new solution.' });

    expect(same.pack.revision).toBe(first.pack.revision);
    expect(changed.pack.revision).not.toBe(first.pack.revision);
  });

  it('exports every current WTA problem with runnable Python metadata and four cases', async () => {
    expect(PAIRY_EXECUTABLE_SOURCE_NUMBERS).toEqual([2, 3, 19, 49, 138, 304, 349, 901, 1700, 2594]);

    for (const sourceNumber of PAIRY_EXECUTABLE_SOURCE_NUMBERS) {
      const execution = getPairyExecutableProblem(sourceNumber);
      expect(execution?.languages).toEqual(['python']);
      expect(execution?.starterCode.python).toContain('sys.stdin.read()');
      expect(execution?.starterCode.python).toContain('json.loads(_raw)');
      expect(execution?.testCases).toHaveLength(4);
      expect(execution?.testCases.filter(({ isHidden }) => isHidden)).toHaveLength(2);
      expect(execution?.testCases.filter(({ isHidden }) => !isHidden)).toHaveLength(2);
      for (const testCase of execution?.testCases ?? []) {
        expect(() => JSON.parse(testCase.input)).not.toThrow();
        expect(() => JSON.parse(testCase.expectedOutput)).not.toThrow();
      }

      const pack = await createPairyQuestionPack({ ...problem, sourceNumber });
      expect(pack.questions[0]?.execution).toEqual({ mode: 'stdin_tests', ...execution });
      expect(pack.questions[0]?.promptMarkdown).toContain('### Pairy test runner');
      expect(new Blob([JSON.stringify(pack)]).size).toBeLessThan(1_000_000);
    }
  });

  it('keeps problems outside the executable bank on the manual fallback', async () => {
    expect(getPairyExecutableProblem(56)).toBeNull();
    expect((await createPairyQuestionPack(problem)).questions[0]?.execution).toEqual({ mode: 'manual' });
    expect((await createPairyQuestionPack({
      ...problem,
      source: 'manual',
      sourceNumber: 3,
    })).questions[0]?.execution).toEqual({ mode: 'manual' });
  });

  it('keeps valid HTTP(S) source URLs and omits incompatible stored values', async () => {
    const valid = await createPairyQuestionPack({
      ...problem,
      sourceUrl: '  http://example.com/problem  ',
    });
    const relative = await createPairyQuestionPack({ ...problem, sourceUrl: 'leetcode.com/problem' });
    const unsafe = await createPairyQuestionPack({ ...problem, sourceUrl: 'javascript:alert(1)' });

    expect(valid.questions[0]!.source.url).toBe('http://example.com/problem');
    expect(relative.questions[0]!.source.url).toBeNull();
    expect(unsafe.questions[0]!.source.url).toBeNull();
  });

  it('creates a safe, recognizable download filename', () => {
    expect(pairyQuestionPackFilename(' Merge Intervals! ')).toBe('merge-intervals.pairy.json');
    expect(pairyQuestionPackFilename('🔥')).toBe('wta-question.pairy.json');
  });
});
