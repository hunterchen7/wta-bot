import {
  appendPairyExecutionNote,
  getPairyExecutableProblem,
  type PairyExecutableProblem,
} from './pairy-executable-problems';

export type PairyQuestionDifficulty = 'easy' | 'medium' | 'hard';

export type PairyQuestionExecution =
  | { mode: 'manual' }
  | ({ mode: 'stdin_tests' } & PairyExecutableProblem);

export type PairyQuestionPackV1 = {
  kind: 'pairy.question-pack';
  schemaVersion: 1;
  pack: {
    id: string;
    revision: string;
    title: string;
    access: 'assigned-private';
  };
  questions: Array<{
    origin: {
      namespace: 'wta-bot';
      key: string;
      revision: string;
    };
    title: string;
    difficulty: PairyQuestionDifficulty;
    promptMarkdown: string;
    interviewer: {
      hintsMarkdown: string;
      solutionMarkdown: string;
    };
    execution: PairyQuestionExecution;
    source: {
      provider: string;
      externalId: string | null;
      url: string | null;
    };
    extensions: {
      wta: {
        availableRounds: number[];
      };
    };
  }>;
};

export type WtaPairyQuestionInput = {
  portableId: string;
  title: string;
  difficulty: PairyQuestionDifficulty;
  promptMarkdown: string;
  hintsMarkdown: string | null;
  solutionMarkdown: string | null;
  source: string;
  sourceNumber: number | null;
  sourceUrl: string | null;
  availableRounds: number[];
};

/** Build the portable, participant-free representation of one assigned problem. */
export async function createPairyQuestionPack(
  input: WtaPairyQuestionInput,
): Promise<PairyQuestionPackV1> {
  const availableRounds = [...new Set(input.availableRounds)]
    .filter((round) => Number.isInteger(round) && round > 0 && round <= 52)
    .sort((a, b) => a - b);
  // The specs are keyed by their upstream LeetCode IDs. A manual/custom bank
  // may reuse the same numeric value, so never infer a harness from the number
  // unless the provider matches as well.
  const executable = input.source.trim().toLowerCase() === 'leetcode'
    ? getPairyExecutableProblem(input.sourceNumber)
    : null;
  const question = {
    title: input.title.trim(),
    difficulty: input.difficulty,
    promptMarkdown: executable
      ? appendPairyExecutionNote(input.promptMarkdown)
      : input.promptMarkdown.trim(),
    interviewer: {
      hintsMarkdown: input.hintsMarkdown?.trim() ?? '',
      solutionMarkdown: input.solutionMarkdown?.trim() ?? '',
    },
    execution: executable
      ? { mode: 'stdin_tests' as const, ...executable }
      : { mode: 'manual' as const },
    source: {
      provider: input.source.trim() || 'manual',
      externalId: input.sourceNumber == null ? null : String(input.sourceNumber),
      // Legacy/admin-authored rows may contain labels or relative URLs. Pairy
      // intentionally accepts only absolute HTTP(S) links, so omit anything
      // outside that contract instead of invalidating the whole packet.
      url: httpUrlOrNull(input.sourceUrl),
    },
    extensions: { wta: { availableRounds } },
  };
  const revision = `sha256:${await sha256(JSON.stringify(question))}`;

  return {
    kind: 'pairy.question-pack',
    schemaVersion: 1,
    pack: {
      id: `wta:${input.portableId}`,
      revision,
      title: question.title,
      access: 'assigned-private',
    },
    questions: [{
      origin: { namespace: 'wta-bot', key: input.portableId, revision },
      ...question,
    }],
  };
}

function httpUrlOrNull(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

export function pairyQuestionPackFilename(title: string): string {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'wta-question'}.pairy.json`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
