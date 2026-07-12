CREATE TABLE practice_problems (
  id INTEGER PRIMARY KEY,
  week_idx INTEGER NOT NULL CHECK (week_idx > 0),
  source TEXT NOT NULL DEFAULT 'leetcode',
  number INTEGER,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (week_idx, url)
);

INSERT INTO practice_problems (week_idx, number, title, url, difficulty) VALUES
  (1, 739, 'Daily Temperatures', 'https://leetcode.com/problems/daily-temperatures/', 'medium'),
  (1, 11, 'Container With Most Water', 'https://leetcode.com/problems/container-with-most-water/description/', 'medium'),
  (1, 3070, 'Count Submatrices with Top-Left Element and Sum Less Than or Equal to K', 'https://leetcode.com/problems/count-submatrices-with-top-left-element-and-sum-less-than-k/description', 'easy'),
  (2, 875, 'Koko Eating Bananas', 'https://leetcode.com/problems/koko-eating-bananas/description/', 'medium'),
  (2, 146, 'LRU Cache', 'https://leetcode.com/problems/lru-cache/description/', 'medium'),
  (2, 567, 'Permutation in String', 'https://leetcode.com/problems/permutation-in-string/description/', 'medium');
