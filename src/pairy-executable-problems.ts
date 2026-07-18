export type ExecutableTestCase = {
  description: string;
  input: string;
  expectedOutput: string;
  isHidden: boolean;
};

export type ExecutableProblem = {
  languages: ['python'];
  starterCode: { python: string };
  testCases: ExecutableTestCase[];
};

/** Compatibility names for the original Pairy-export-only implementation. */
export type PairyExecutableTestCase = ExecutableTestCase;
export type PairyExecutableProblem = ExecutableProblem;

const executionNote = `### Test runner

The supplied starter code reads one value from standard input for each test and prints the result. Implement the requested method or class without removing the runner code.`;

const specs = {
  304: {
    starterCode: `import json
import sys

class NumMatrix:
    def __init__(self, matrix):
        # TODO: preprocess matrix so each query runs in O(1).
        pass

    def sumRegion(self, row1, col1, row2, col2):
        # TODO: return the inclusive rectangle sum.
        return 0

def _run(data):
    matrix = NumMatrix(data["matrix"])
    return [matrix.sumRegion(*query) for query in data["queries"]]

try:
    _raw = sys.stdin.read()
except OSError:
    _raw = ""
if _raw.strip():
    print(json.dumps(_run(json.loads(_raw)), separators=(",", ":")))
`,
    testCases: [
      visible('example queries', { matrix: [[3, 0, 1, 4, 2], [5, 6, 3, 2, 1], [1, 2, 0, 1, 5], [4, 1, 0, 1, 7], [1, 0, 3, 0, 5]], queries: [[2, 1, 4, 3], [1, 1, 2, 2], [1, 2, 2, 4]] }, [8, 11, 12]),
      visible('single negative cell', { matrix: [[-5]], queries: [[0, 0, 0, 0]] }, [-5]),
      hidden('one-row ranges', { matrix: [[1, 2, 3, 4]], queries: [[0, 0, 0, 3], [0, 1, 0, 2]] }, [10, 5]),
      hidden('mixed values and subregions', { matrix: [[1, -2], [3, 4]], queries: [[0, 0, 1, 1], [0, 1, 0, 1], [1, 0, 1, 1]] }, [6, -2, 7]),
    ],
  },
  49: {
    starterCode: `import json
import sys

class Solution:
    def groupAnagrams(self, strs):
        # TODO: group strings that have the same character counts.
        return []

def _run(data):
    groups = Solution().groupAnagrams(data["strs"])
    return sorted(sorted(group) for group in groups)

try:
    _raw = sys.stdin.read()
except OSError:
    _raw = ""
if _raw.strip():
    print(json.dumps(_run(json.loads(_raw)), separators=(",", ":")))
`,
    testCases: [
      visible('multiple anagram groups', { strs: ['eat', 'tea', 'tan', 'ate', 'nat', 'bat'] }, [['ate', 'eat', 'tea'], ['bat'], ['nat', 'tan']]),
      visible('empty string', { strs: [''] }, [['']]),
      hidden('single string', { strs: ['a'] }, [['a']]),
      hidden('different group sizes', { strs: ['ab', 'ba', 'abc', 'cab', 'bca', 'foo'] }, [['ab', 'ba'], ['abc', 'bca', 'cab'], ['foo']]),
    ],
  },
  1700: {
    starterCode: `import json
import sys

class Solution:
    def countStudents(self, students, sandwiches):
        # TODO: return the number of students who cannot eat.
        return 0

def _run(data):
    return Solution().countStudents(data["students"], data["sandwiches"])

try:
    _raw = sys.stdin.read()
except OSError:
    _raw = ""
if _raw.strip():
    print(json.dumps(_run(json.loads(_raw)), separators=(",", ":")))
`,
    testCases: [
      visible('everyone eats after rotations', { students: [1, 1, 0, 0], sandwiches: [0, 1, 0, 1] }, 0),
      visible('three students remain', { students: [1, 1, 1, 0, 0, 1], sandwiches: [1, 0, 0, 0, 1, 1] }, 3),
      hidden('nobody wants the top type', { students: [0, 0], sandwiches: [1, 1] }, 2),
      hidden('one matching student', { students: [0], sandwiches: [0] }, 0),
    ],
  },
  901: {
    starterCode: `import json
import sys

class StockSpanner:
    def __init__(self):
        # TODO: initialize your data structure.
        pass

    def next(self, price):
        # TODO: record price and return today's span.
        return 1

def _run(data):
    spanner = StockSpanner()
    return [spanner.next(price) for price in data["prices"]]

try:
    _raw = sys.stdin.read()
except OSError:
    _raw = ""
if _raw.strip():
    print(json.dumps(_run(json.loads(_raw)), separators=(",", ":")))
`,
    testCases: [
      visible('example price stream', { prices: [100, 80, 60, 70, 60, 75, 85] }, [1, 1, 1, 2, 1, 4, 6]),
      visible('strictly increasing prices', { prices: [10, 20, 30] }, [1, 2, 3]),
      hidden('equal prices extend the span', { prices: [50, 50, 50] }, [1, 2, 3]),
      hidden('strictly decreasing prices', { prices: [100, 90, 80] }, [1, 1, 1]),
    ],
  },
  349: {
    starterCode: `import json
import sys

class Solution:
    def intersection(self, nums1, nums2):
        # TODO: return each shared value exactly once.
        return []

def _run(data):
    return sorted(Solution().intersection(data["nums1"], data["nums2"]))

try:
    _raw = sys.stdin.read()
except OSError:
    _raw = ""
if _raw.strip():
    print(json.dumps(_run(json.loads(_raw)), separators=(",", ":")))
`,
    testCases: [
      visible('duplicates collapse', { nums1: [1, 2, 2, 1], nums2: [2, 2] }, [2]),
      visible('output order is normalized', { nums1: [4, 9, 5], nums2: [9, 4, 9, 8, 4] }, [4, 9]),
      hidden('disjoint arrays', { nums1: [1, 2], nums2: [3, 4] }, []),
      hidden('many repeated matches', { nums1: [1, 1, 1], nums2: [1, 1] }, [1]),
    ],
  },
  19: {
    starterCode: `import json
import sys

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class Solution:
    def removeNthFromEnd(self, head, n):
        # TODO: remove the nth node from the end and return the head.
        return head

def _build(values):
    dummy = ListNode()
    tail = dummy
    for value in values:
        tail.next = ListNode(value)
        tail = tail.next
    return dummy.next

def _values(head):
    result = []
    while head:
        result.append(head.val)
        head = head.next
    return result

def _run(data):
    return _values(Solution().removeNthFromEnd(_build(data["head"]), data["n"]))

try:
    _raw = sys.stdin.read()
except OSError:
    _raw = ""
if _raw.strip():
    print(json.dumps(_run(json.loads(_raw)), separators=(",", ":")))
`,
    testCases: [
      visible('remove from the middle', { head: [1, 2, 3, 4, 5], n: 2 }, [1, 2, 3, 5]),
      visible('remove the only node', { head: [1], n: 1 }, []),
      hidden('remove the tail', { head: [1, 2], n: 1 }, [1]),
      hidden('remove the head', { head: [1, 2, 3], n: 3 }, [2, 3]),
    ],
  },
  138: {
    starterCode: `import json
import sys

class Node:
    def __init__(self, val=0, next=None, random=None):
        self.val = val
        self.next = next
        self.random = random

class Solution:
    def copyRandomList(self, head):
        # TODO: return a deep copy of the list.
        return None

def _build(items):
    nodes = [Node(value) for value, _ in items]
    for index, (_, random_index) in enumerate(items):
        nodes[index].next = nodes[index + 1] if index + 1 < len(nodes) else None
        nodes[index].random = nodes[random_index] if random_index is not None else None
    return (nodes[0] if nodes else None), nodes

def _serialize(head, originals):
    nodes = []
    current = head
    while current:
        if current in originals:
            raise AssertionError("copy contains an original node")
        nodes.append(current)
        current = current.next
    index = {node: position for position, node in enumerate(nodes)}
    result = []
    for node in nodes:
        if node.random in originals:
            raise AssertionError("random pointer targets an original node")
        result.append([node.val, index.get(node.random)])
    return result

def _run(data):
    head, originals = _build(data["nodes"])
    return _serialize(Solution().copyRandomList(head), set(originals))

try:
    _raw = sys.stdin.read()
except OSError:
    _raw = ""
if _raw.strip():
    print(json.dumps(_run(json.loads(_raw)), separators=(",", ":")))
`,
    testCases: [
      visible('five-node random list', { nodes: [[7, null], [13, 0], [11, 4], [10, 2], [1, 0]] }, [[7, null], [13, 0], [11, 4], [10, 2], [1, 0]]),
      visible('empty list', { nodes: [] }, []),
      hidden('self-referencing random pointers', { nodes: [[1, 1], [2, 1]] }, [[1, 1], [2, 1]]),
      hidden('duplicate values', { nodes: [[3, null], [3, 0], [3, null]] }, [[3, null], [3, 0], [3, null]]),
    ],
  },
  2: {
    starterCode: `import json
import sys

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class Solution:
    def addTwoNumbers(self, l1, l2):
        # TODO: return the reversed-digit sum list.
        return None

def _build(values):
    dummy = ListNode()
    tail = dummy
    for value in values:
        tail.next = ListNode(value)
        tail = tail.next
    return dummy.next

def _values(head):
    result = []
    while head:
        result.append(head.val)
        head = head.next
    return result

def _run(data):
    return _values(Solution().addTwoNumbers(_build(data["l1"]), _build(data["l2"])))

try:
    _raw = sys.stdin.read()
except OSError:
    _raw = ""
if _raw.strip():
    print(json.dumps(_run(json.loads(_raw)), separators=(",", ":")))
`,
    testCases: [
      visible('same-length inputs', { l1: [2, 4, 3], l2: [5, 6, 4] }, [7, 0, 8]),
      visible('two zeroes', { l1: [0], l2: [0] }, [0]),
      hidden('carry extends the result', { l1: [9, 9, 9, 9, 9, 9, 9], l2: [9, 9, 9, 9] }, [8, 9, 9, 9, 0, 0, 0, 1]),
      hidden('single-digit carry', { l1: [5], l2: [5] }, [0, 1]),
    ],
  },
  2594: {
    starterCode: `import json
import sys

class Solution:
    def repairCars(self, ranks, cars):
        # TODO: return the minimum time needed to repair every car.
        return 0

def _run(data):
    return Solution().repairCars(data["ranks"], data["cars"])

try:
    _raw = sys.stdin.read()
except OSError:
    _raw = ""
if _raw.strip():
    print(json.dumps(_run(json.loads(_raw)), separators=(",", ":")))
`,
    testCases: [
      visible('four mechanics', { ranks: [4, 2, 3, 1], cars: 10 }, 16),
      visible('uneven ranks', { ranks: [5, 1, 8], cars: 6 }, 16),
      hidden('one mechanic and one car', { ranks: [1], cars: 1 }, 1),
      hidden('two mechanics split five cars', { ranks: [2, 3], cars: 5 }, 18),
    ],
  },
  3: {
    starterCode: `import json
import sys

class Solution:
    def lengthOfLongestSubstring(self, s):
        # TODO: return the longest substring length without repeats.
        return 0

def _run(data):
    return Solution().lengthOfLongestSubstring(data["s"])

try:
    _raw = sys.stdin.read()
except OSError:
    _raw = ""
if _raw.strip():
    print(json.dumps(_run(json.loads(_raw)), separators=(",", ":")))
`,
    testCases: [
      visible('repeating cycle', { s: 'abcabcbb' }, 3),
      visible('one repeated character', { s: 'bbbbb' }, 1),
      hidden('empty string', { s: '' }, 0),
      hidden('spaces count as characters', { s: 'a b a' }, 3),
    ],
  },
} satisfies Record<number, { starterCode: string; testCases: ExecutableTestCase[] }>;

export const EXECUTABLE_SOURCE_NUMBERS = Object.freeze(
  Object.keys(specs).map(Number).sort((a, b) => a - b),
);
export const PAIRY_EXECUTABLE_SOURCE_NUMBERS = EXECUTABLE_SOURCE_NUMBERS;

export function getExecutableProblem(
  sourceNumber: number | null,
): ExecutableProblem | null {
  if (sourceNumber == null || !(sourceNumber in specs)) return null;
  const spec = specs[sourceNumber as keyof typeof specs];
  return {
    languages: ['python'],
    starterCode: { python: spec.starterCode },
    testCases: spec.testCases.map((testCase) => ({ ...testCase })),
  };
}
export const getPairyExecutableProblem = getExecutableProblem;

export function appendExecutionNote(promptMarkdown: string): string {
  return `${promptMarkdown.trim()}\n\n${executionNote}`;
}
export const appendPairyExecutionNote = appendExecutionNote;

function visible(description: string, input: unknown, output: unknown): ExecutableTestCase {
  return testCase(description, input, output, false);
}

function hidden(description: string, input: unknown, output: unknown): ExecutableTestCase {
  return testCase(description, input, output, true);
}

function testCase(
  description: string,
  input: unknown,
  output: unknown,
  isHidden: boolean,
): ExecutableTestCase {
  return {
    description,
    input: JSON.stringify(input),
    expectedOutput: JSON.stringify(output),
    isHidden,
  };
}
