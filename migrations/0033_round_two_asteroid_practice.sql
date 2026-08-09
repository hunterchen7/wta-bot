INSERT INTO practice_problems (
  week_idx,
  source,
  number,
  title,
  url,
  difficulty,
  active,
  content_md
)
SELECT
  2,
  'leetcode',
  735,
  'Asteroid Collision',
  'https://leetcode.com/problems/asteroid-collision/',
  'medium',
  1,
  '## Problem

You are given a row of asteroids represented by integers. The absolute value is an asteroid''s size. Its sign gives its direction: positive moves right and negative moves left.

When two asteroids moving toward each other collide, the smaller asteroid is destroyed. If they have equal size, both are destroyed. Asteroids moving in the same direction never collide.

Return the asteroids that remain after every collision.

### Example

```text
Input:  [5, 10, -5]
Output: [5, 10]
```

The asteroid with size 10 destroys the asteroid with size 5 moving toward it.

## Approach

Keep a stack of asteroids that have survived so far. A new asteroid can collide only when it moves left and the asteroid at the top of the stack moves right.

While that collision is possible, compare their sizes:

- Remove the smaller asteroid.
- Remove both when their sizes are equal.
- Stop when the incoming asteroid is destroyed or no collision is possible.

Push the incoming asteroid if it survives.

## Complexity

- **Time:** `O(n)` because every asteroid is pushed and removed at most once.
- **Space:** `O(n)` for the survivor stack.'
WHERE NOT EXISTS (
  SELECT 1 FROM practice_problems WHERE week_idx = 2 AND number = 735
);
