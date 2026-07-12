import { describe, expect, it } from 'vitest';
import { normalizeAvailableWeeks, parseQuestionMarkdown } from '../src/question-markdown';

describe('question Markdown', () => {
  it('derives packet visibility sections from one Markdown document', () => {
    const sections = parseQuestionMarkdown(`# Context

Shared setup.

## Statement

Solve **the problem**.

## Hints

1. Start small.
2. Use a map.

## Solution

The solution is $O(n)$.
`);
    expect(sections).toEqual({
      statement: 'Solve **the problem**.',
      hints: '1. Start small.\n2. Use a map.',
      solution: 'The solution is $O(n)$.',
    });
  });

  it('normalizes round tags', () => {
    expect(normalizeAvailableWeeks([3, '1', 3, 0, 53, 'nope'])).toEqual([1, 3]);
  });
});
