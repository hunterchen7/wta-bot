ALTER TABLE practice_problems ADD COLUMN content_md TEXT NOT NULL DEFAULT '';

UPDATE practice_problems SET content_md = '## Problem

You are given one temperature reading for each day. For every day, return the number of days you would need to wait to see a warmer temperature. If no warmer day appears later, return `0` for that day.

### Example

```text
Input:  [73, 74, 75, 71, 69, 72, 76, 73]
Output: [ 1,  1,  4,  2,  1,  1,  0,  0]
```

Day 3 has temperature 71. The next warmer temperature is 72 two days later, so its answer is 2.

## Constraints

- There is at least one temperature.
- Temperatures are whole numbers.
- Aim for a solution that processes each day only a constant number of times.

## Approach

Keep a stack of day indices whose next warmer day is still unknown. The temperatures at those indices stay in decreasing order.

For each new day, compare its temperature with the day on top of the stack. While the new day is warmer, pop that earlier index and record the distance between the two days. Push the new index when no more earlier days can be resolved.

## Why it works

An index leaves the stack at the first warmer temperature to its right, which is exactly the day it needs. Any index left in the stack at the end has no warmer future day and keeps the default answer of zero.

## Complexity

- **Time:** `O(n)` because each index is pushed and popped at most once.
- **Space:** `O(n)` in the worst case.' WHERE number = 739;

UPDATE practice_problems SET content_md = '## Problem

You are given the heights of vertical lines placed one unit apart. Choose two lines to form the sides of a container. The water level is limited by the shorter line; find the maximum amount of water any pair can hold.

### Example

```text
Input:  [1, 8, 6, 2, 5, 4, 8, 3, 7]
Output: 49
```

The lines with heights 8 and 7 are seven units apart, so they hold `min(8, 7) × 7 = 49` units.

## Constraints

- At least two lines are provided.
- Heights are non-negative whole numbers.
- Lines cannot be tilted.

## Approach

Start one pointer at each end. This gives the widest possible container. Record its area, then move the pointer at the shorter wall inward.

Moving the taller wall cannot improve the current area: the width gets smaller while the shorter wall still limits the height. Moving the shorter wall is the only move that might discover a taller limiting wall.

## Complexity

- **Time:** `O(n)`.
- **Space:** `O(1)`.' WHERE number = 11;

UPDATE practice_problems SET content_md = '## Problem

You are given a grid of non-negative integers and a limit `k`. Count the rectangular submatrices whose top-left corner is the grid''s top-left cell and whose sum is at most `k`.

### Example

```text
Grid: [[7, 6, 3],
       [6, 6, 1]]
k: 18
Output: 4
```

Every candidate is determined by its bottom-right corner. Count the candidates whose accumulated sum stays within the limit.

## Constraints

- The grid has at least one row and one column.
- Values and `k` are non-negative.

## Approach

Build a two-dimensional prefix sum while scanning the grid. At `(row, col)`, combine the sum above and the sum to the left, subtract their double-counted overlap, then add the current cell.

Because each requested submatrix starts at `(0, 0)`, that prefix value is already its complete sum. Increment the answer whenever it is at most `k`.

## Complexity

- **Time:** `O(rows × columns)`.
- **Space:** `O(rows × columns)`, or `O(columns)` with a rolling prefix row.' WHERE number = 3070;

UPDATE practice_problems SET content_md = '## Problem

Several piles of bananas must be eaten within `h` hours. At a chosen integer speed `k`, up to `k` bananas can be eaten from one pile per hour. Find the smallest speed that finishes every pile on time.

### Example

```text
Piles: [3, 6, 7, 11]
Hours: 8
Output: 4
```

At speed 4, the piles require `1 + 2 + 2 + 3 = 8` hours.

## Constraints

- Every pile contains at least one banana.
- The available hours are sufficient to visit every pile.
- The answer is between 1 and the largest pile.

## Approach

Binary-search the possible speed. For a candidate speed `k`, a pile of size `p` takes `ceil(p / k)` hours. Sum those hours to test whether the candidate is fast enough.

Feasibility is monotonic: once one speed can finish on time, every faster speed can too. When a speed works, search the lower half; otherwise, search the upper half.

## Complexity

- **Time:** `O(n log m)`, where `m` is the largest pile.
- **Space:** `O(1)`.' WHERE number = 875;

UPDATE practice_problems SET content_md = '## Problem

Design a fixed-capacity key-value cache with two operations:

- `get(key)` returns the stored value, or `-1` when the key is absent.
- `put(key, value)` inserts or updates a value. When the cache is full, it removes the key that has gone unused for the longest time.

Both operations should run in constant time.

### Example

```text
capacity = 2
put(1, 10)
put(2, 20)
get(1)     -> 10
put(3, 30) -> evicts key 2
get(2)     -> -1
```

## Approach

Use two structures together:

1. A hash map finds the node for any key in `O(1)` time.
2. A doubly linked list keeps nodes ordered by recency. The front is most recently used; the back is least recently used.

Whenever a key is read or updated, detach its node and move it to the front. When inserting beyond capacity, remove the node at the back and delete its key from the map.

## Why both structures are needed

A map gives fast lookup but no recency order. A linked list gives fast removal and reordering when you already have a node, but not fast lookup. Together they satisfy both requirements.

## Complexity

- **Time:** `O(1)` average for `get` and `put`.
- **Space:** `O(capacity)`.' WHERE number = 146;

UPDATE practice_problems SET content_md = '## Problem

Given strings `pattern` and `text`, determine whether `text` contains a contiguous substring that is a permutation of `pattern`. The characters may appear in a different order, but their counts must match exactly.

### Example

```text
pattern: "ab"
text:    "eidbaooo"
Output:  true
```

The substring `"ba"` contains the same character counts as `"ab"`.

## Constraints

- Both strings are non-empty.
- Matching is case-sensitive.
- The matching window must have exactly the same length as `pattern`.

## Approach

Build a frequency count for `pattern`, then slide a fixed-size window of that same length across `text`. Add the character entering the window and remove the one leaving it.

Compare the window counts with the target counts after each move. An implementation can compare the full count arrays, or maintain a running number of character counts that currently match.

## Complexity

- **Time:** `O(n)` when the alphabet size is fixed.
- **Space:** `O(1)` for a fixed alphabet, otherwise `O(a)` for the distinct characters.' WHERE number = 567;
