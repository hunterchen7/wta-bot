import { describe, expect, it } from 'vitest';
import {
  createPairyQuestionPack,
  pairyQuestionPackFilename,
  type WtaPairyQuestionInput,
} from '../src/pairy-question-pack';

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

  it('creates a safe, recognizable download filename', () => {
    expect(pairyQuestionPackFilename(' Merge Intervals! ')).toBe('merge-intervals.pairy.json');
    expect(pairyQuestionPackFilename('🔥')).toBe('wta-question.pairy.json');
  });
});
