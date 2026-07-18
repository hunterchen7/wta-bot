import { describe, expect, it } from 'vitest';
import {
  getPairyExecutableProblem,
  PAIRY_EXECUTABLE_SOURCE_NUMBERS,
} from '../src/pairy-executable-problems';

describe('current executable Pairy problem bank (#3)', () => {
  it('ships independently verified expected output for every test case', () => {
    for (const sourceNumber of PAIRY_EXECUTABLE_SOURCE_NUMBERS) {
      const spec = getPairyExecutableProblem(sourceNumber);
      expect(spec).not.toBeNull();
      for (const testCase of spec?.testCases ?? []) {
        expect(referenceOutput(sourceNumber, JSON.parse(testCase.input))).toBe(
          testCase.expectedOutput,
        );
      }
    }
  });

  it('returns defensive test-case copies', () => {
    const first = getPairyExecutableProblem(3)!;
    first.testCases[0]!.description = 'changed';
    expect(getPairyExecutableProblem(3)!.testCases[0]!.description).toBe('repeating cycle');
  });
});

function referenceOutput(sourceNumber: number, input: any): string {
  switch (sourceNumber) {
    case 304:
      return json(input.queries.map(([r1, c1, r2, c2]: [number, number, number, number]) => {
        const matrix = input.matrix as number[][];
        let total = 0;
        for (let row = r1; row <= r2; row += 1) {
          for (let col = c1; col <= c2; col += 1) total += matrix[row]![col]!;
        }
        return total;
      }));
    case 49: {
      const groups = new Map<string, string[]>();
      for (const value of input.strs as string[]) {
        const key = [...value].sort().join('');
        groups.set(key, [...(groups.get(key) ?? []), value]);
      }
      return json([...groups.values()].map((group) => group.sort()).sort(compareArrays));
    }
    case 1700: {
      const remaining: [number, number] = [0, 0];
      for (const student of input.students as Array<0 | 1>) remaining[student] += 1;
      for (const sandwich of input.sandwiches as Array<0 | 1>) {
        if (remaining[sandwich] === 0) break;
        remaining[sandwich] -= 1;
      }
      return json(remaining[0] + remaining[1]);
    }
    case 901:
      return json((input.prices as number[]).map((price, index, prices) => {
        let span = 1;
        while (index - span >= 0 && prices[index - span]! <= price) span += 1;
        return span;
      }));
    case 349: {
      const second = new Set<number>(input.nums2);
      return json([...new Set<number>(input.nums1)].filter((value) => second.has(value)).sort((a, b) => a - b));
    }
    case 19: {
      const values = [...input.head] as number[];
      values.splice(values.length - input.n, 1);
      return json(values);
    }
    case 138:
      return json(input.nodes);
    case 2: {
      const result: number[] = [];
      let carry = 0;
      const length = Math.max(input.l1.length, input.l2.length);
      for (let index = 0; index < length || carry; index += 1) {
        const sum = (input.l1[index] ?? 0) + (input.l2[index] ?? 0) + carry;
        result.push(sum % 10);
        carry = Math.floor(sum / 10);
      }
      return json(result);
    }
    case 2594: {
      let low = 0;
      let high = Math.min(...input.ranks) * input.cars * input.cars;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        const repaired = input.ranks.reduce(
          (total: number, rank: number) => total + Math.floor(Math.sqrt(mid / rank)),
          0,
        );
        if (repaired >= input.cars) high = mid;
        else low = mid + 1;
      }
      return json(low);
    }
    case 3: {
      const last = new Map<string, number>();
      let left = 0;
      let best = 0;
      for (const [index, character] of [...input.s].entries()) {
        left = Math.max(left, (last.get(character) ?? -1) + 1);
        last.set(character, index);
        best = Math.max(best, index - left + 1);
      }
      return json(best);
    }
    default:
      throw new Error(`Missing reference evaluator for ${sourceNumber}`);
  }
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function compareArrays(a: string[], b: string[]): number {
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}
