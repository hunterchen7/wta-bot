export type QuestionSections = {
  statement: string;
  hints: string;
  solution: string;
};

export const EMPTY_QUESTION_MARKDOWN = `## Statement



## Hints

1.

## Solution

`;

/** Pull the visibility-sensitive packet sections out of one Markdown source. */
export function parseQuestionMarkdown(markdown: string): QuestionSections {
  const source = markdown.replaceAll('\r\n', '\n').trim();
  const sections: QuestionSections = { statement: '', hints: '', solution: '' };
  const headings = [...source.matchAll(/^##\s+(Statement|Hints|Solution)\s*$/gim)];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]!;
    const next = headings[index + 1];
    const key = heading[1]!.toLowerCase() as keyof QuestionSections;
    sections[key] = source.slice(heading.index! + heading[0].length, next?.index ?? source.length).trim();
  }
  return sections;
}

export function composeQuestionMarkdown(input: Partial<QuestionSections>): string {
  return [
    `## Statement\n\n${input.statement?.trim() ?? ''}`,
    `## Hints\n\n${input.hints?.trim() ?? ''}`,
    `## Solution\n\n${input.solution?.trim() ?? ''}`,
  ].join('\n\n');
}

export function normalizeAvailableWeeks(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((week) => Number.isInteger(week) && week > 0 && week <= 52))]
    .sort((a, b) => a - b);
}

export function readAvailableWeeks(value: string | null | undefined): number[] {
  try {
    return normalizeAvailableWeeks(value ? JSON.parse(value) : []);
  } catch {
    return [];
  }
}
