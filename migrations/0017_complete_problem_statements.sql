-- Keep interviewer packets self-contained. These original restatements include
-- the complete task, callable interface, examples, and constraints so an
-- interview never depends on opening an external problem page.

UPDATE problems SET statement_md = 'You are given an integer matrix. After one preprocessing step, answer many queries asking for the sum of every value inside an inclusive rectangular region.

### Interface

Implement the `NumMatrix` class:

- `NumMatrix(matrix)` stores and preprocesses the matrix.
- `sumRegion(row1, col1, row2, col2)` returns the sum inside the rectangle whose upper-left corner is `(row1, col1)` and lower-right corner is `(row2, col2)`.

Each query must run in `O(1)` time.

### Example

```text
matrix = [
  [3, 0, 1, 4, 2],
  [5, 6, 3, 2, 1],
  [1, 2, 0, 1, 5],
  [4, 1, 0, 1, 7],
  [1, 0, 3, 0, 5]
]

sumRegion(2, 1, 4, 3) -> 8
sumRegion(1, 1, 2, 2) -> 11
sumRegion(1, 2, 2, 4) -> 12
```

For example, the first query includes rows 2 through 4 and columns 1 through 3, producing `2 + 0 + 1 + 1 + 0 + 1 + 0 + 3 + 0 = 8`.

### Constraints

- `m == matrix.length` and `n == matrix[i].length`
- `1 <= m, n <= 200`
- `-10^4 <= matrix[i][j] <= 10^4`
- `0 <= row1 <= row2 < m`
- `0 <= col1 <= col2 < n`
- At most `10^4` calls are made to `sumRegion`.' WHERE number = 304;

UPDATE problems SET statement_md = 'Given an array of lowercase strings, place strings that are anagrams of one another into the same group. Two strings are anagrams when one can be rearranged to produce the other. The groups and the strings within each group may be returned in any order.

### Interface

```python
def groupAnagrams(strs: list[str]) -> list[list[str]]:
```

### Examples

```text
Input:  strs = ["eat", "tea", "tan", "ate", "nat", "bat"]
Output: [["bat"], ["nat", "tan"], ["ate", "eat", "tea"]]
```

`eat`, `tea`, and `ate` form one group; `tan` and `nat` form another; `bat` has no partner. Other group orderings are also valid.

```text
Input:  strs = [""]
Output: [[""]]

Input:  strs = ["a"]
Output: [["a"]]
```

### Constraints

- `1 <= strs.length <= 10^4`
- `0 <= strs[i].length <= 100`
- Every string contains only lowercase English letters.' WHERE number = 49;

UPDATE problems SET statement_md = 'A cafeteria has circular sandwiches (`0`) and square sandwiches (`1`). Students begin in a queue, and every student prefers exactly one type. The sandwich array represents a stack with index `0` at the top.

Repeat the following process:

1. If the student at the front wants the top sandwich, that student takes it and leaves the queue.
2. Otherwise, that student moves to the back of the queue without taking a sandwich.

The process stops when nobody remaining in the queue wants the current top sandwich. Return how many students cannot eat.

### Interface

```python
def countStudents(students: list[int], sandwiches: list[int]) -> int:
```

### Examples

```text
Input:  students = [1, 1, 0, 0]
        sandwiches = [0, 1, 0, 1]
Output: 0
```

After students rotate through the queue, each top sandwich eventually reaches a student who wants it, so everyone eats.

```text
Input:  students = [1, 1, 1, 0, 0, 1]
        sandwiches = [1, 0, 0, 0, 1, 1]
Output: 3
```

### Constraints

- `1 <= students.length, sandwiches.length <= 100`
- `students.length == sandwiches.length`
- Every entry in both arrays is either `0` or `1`.' WHERE number = 1700;

UPDATE problems SET statement_md = 'Design a class that receives stock prices one day at a time. For each new price, return its span: the number of consecutive days ending today for which every price was less than or equal to the current price.

### Interface

Implement the `StockSpanner` class:

- `StockSpanner()` creates an empty tracker.
- `next(price)` records the next daily price and returns its span.

### Example

```text
Operations: ["StockSpanner", "next", "next", "next", "next", "next", "next", "next"]
Arguments:  [[], [100], [80], [60], [70], [60], [75], [85]]
Returns:    [null, 1, 1, 1, 2, 1, 4, 6]
```

The price `70` has span `2` because the consecutive suffix `[60, 70]` is at most `70`. The price `75` has span `4` because `[60, 70, 60, 75]` all qualify. The earlier price `80` stops that span.

### Constraints

- `1 <= price <= 10^5`
- At most `10^4` calls are made to `next`.' WHERE number = 901;

UPDATE problems SET statement_md = 'Given two integer arrays, return their intersection. A value belongs in the result if it appears in both inputs. Every returned value must be unique, even when it appears multiple times in either input. The result may be in any order.

### Interface

```python
def intersection(nums1: list[int], nums2: list[int]) -> list[int]:
```

### Examples

```text
Input:  nums1 = [1, 2, 2, 1], nums2 = [2, 2]
Output: [2]
```

```text
Input:  nums1 = [4, 9, 5], nums2 = [9, 4, 9, 8, 4]
Output: [9, 4]
```

`[4, 9]` is also valid because output order does not matter.

### Constraints

- `1 <= nums1.length, nums2.length <= 1000`
- `0 <= nums1[i], nums2[i] <= 1000`.' WHERE number = 349;

UPDATE problems SET statement_md = 'Given the head of a singly linked list, remove the node that is `n` positions from the end and return the possibly updated head. The value `n` is always valid for the supplied list.

### Interface

```python
def removeNthFromEnd(head: ListNode | None, n: int) -> ListNode | None:
```

`ListNode` is provided and contains `val` and `next` fields.

### Examples

```text
Input:  head = [1, 2, 3, 4, 5], n = 2
Output: [1, 2, 3, 5]

Input:  head = [1], n = 1
Output: []

Input:  head = [1, 2], n = 1
Output: [1]
```

### Constraints

- Let `sz` be the number of nodes in the list.
- `1 <= sz <= 30`
- `0 <= Node.val <= 100`
- `1 <= n <= sz`

### Follow-up

Can you remove the correct node with only one pass over the list?' WHERE number = 19;

UPDATE problems SET statement_md = 'A linked list is provided in which every node has three fields: `val`, `next`, and `random`. A random pointer may refer to any node in the same list or may be `null`.

Create a deep copy containing exactly one brand-new node for every original node. Values and pointer relationships must match the original structure, but no `next` or `random` pointer in the copy may refer to an original node. Return the head of the copied list. Your function receives only the original head.

### Interface

```python
def copyRandomList(head: Node | None) -> Node | None:
```

For examples, a node is written as `[value, random_index]`. The second entry is the zero-based index targeted by its random pointer, or `null`.

### Examples

```text
Input:  [[7, null], [13, 0], [11, 4], [10, 2], [1, 0]]
Output: [[7, null], [13, 0], [11, 4], [10, 2], [1, 0]]

Input:  [[1, 1], [2, 1]]
Output: [[1, 1], [2, 1]]

Input:  [[3, null], [3, 0], [3, null]]
Output: [[3, null], [3, 0], [3, null]]
```

The serialized output looks identical, but every output node must be a new object.

### Constraints

- `0 <= n <= 1000`
- `-10^4 <= Node.val <= 10^4`
- Every random pointer is either `null` or points to a node in the given list.' WHERE number = 138;

UPDATE problems SET statement_md = 'Two non-empty singly linked lists encode non-negative integers. Each node contains one digit, and digits appear in reverse order: the head stores the ones place. Add the represented numbers and return the sum using the same reversed linked-list format.

Neither input contains a leading zero in its numeric representation unless the entire number is zero.

### Interface

```python
def addTwoNumbers(l1: ListNode, l2: ListNode) -> ListNode:
```

`ListNode` is provided and contains `val` and `next` fields.

### Examples

```text
Input:  l1 = [2, 4, 3], l2 = [5, 6, 4]
Output: [7, 0, 8]
```

The lists represent `342` and `465`, whose sum is `807`.

```text
Input:  l1 = [0], l2 = [0]
Output: [0]

Input:  l1 = [9, 9, 9, 9, 9, 9, 9], l2 = [9, 9, 9, 9]
Output: [8, 9, 9, 9, 0, 0, 0, 1]
```

### Constraints

- Each list contains between `1` and `100` nodes.
- `0 <= Node.val <= 9`
- Each input is a valid reversed representation with no unnecessary leading zero.' WHERE number = 2;

UPDATE problems SET statement_md = 'An array `ranks` describes a group of mechanics. A mechanic with rank `r` needs `r * n^2` minutes to repair `n` cars. All mechanics work simultaneously, and cars may be distributed among them in any way.

Given the total number of cars waiting, return the minimum number of minutes needed for the group to finish every car.

### Interface

```python
def repairCars(ranks: list[int], cars: int) -> int:
```

### Examples

```text
Input:  ranks = [4, 2, 3, 1], cars = 10
Output: 16
```

In 16 minutes the mechanics can repair `2`, `2`, `2`, and `4` cars respectively. That covers all 10 cars, and no smaller time is sufficient.

```text
Input:  ranks = [5, 1, 8], cars = 6
Output: 16
```

One valid distribution is `1`, `4`, and `1` cars. Their individual completion times are `5`, `16`, and `8` minutes, so the parallel job finishes after 16 minutes.

### Constraints

- `1 <= ranks.length <= 10^5`
- `1 <= ranks[i] <= 100`
- `1 <= cars <= 10^6`.' WHERE number = 2594;

UPDATE problems SET statement_md = 'Given a string, return the length of its longest substring containing no repeated character. A substring must be contiguous; skipping characters to form a subsequence is not allowed.

### Interface

```python
def lengthOfLongestSubstring(s: str) -> int:
```

### Examples

```text
Input:  s = "abcabcbb"
Output: 3
```

`abc`, `bca`, and `cab` are valid longest substrings.

```text
Input:  s = "bbbbb"
Output: 1
```

The only distinct-character substring has one character.

```text
Input:  s = "pwwkew"
Output: 3
```

`wke` is a valid answer. `pwke` does not count because those characters are not contiguous.

### Constraints

- `0 <= s.length <= 5 * 10^4`
- `s` may contain English letters, digits, symbols, and spaces.' WHERE number = 3;

-- The admin editor treats content_md as canonical, so keep it synchronized
-- with the structured fields updated above.
UPDATE problems
SET content_md = '## Statement

' || statement_md || '

## Hints

' || COALESCE(hints_md, '') || '

## Solution

' || COALESCE(solution_md, '')
WHERE number IN (304, 49, 1700, 901, 349, 19, 138, 2, 2594, 3);
