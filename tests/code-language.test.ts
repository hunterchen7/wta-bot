import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../web/src/lib/code-language';

const snippets = {
  Python: `class Solution:\n    def twoSum(self, nums: List[int], target: int):\n        return [0, 1]`,
  Java: `class Solution {\n  public int[] twoSum(int[] nums, int target) {\n    Map<Integer, Integer> seen = new HashMap<>();\n    return new int[] {0, 1};\n  }\n}`,
  'JavaScript/TypeScript': `const twoSum = (nums, target) => {\n  const seen = new Map();\n  return nums.map((value) => value);\n};`,
  'C/C++': `class Solution {\npublic:\n  vector<int> twoSum(vector<int>& nums, int target) {\n    unordered_map<int, int> seen;\n    return {};\n  }\n};`,
  Rust: `impl Solution {\n  pub fn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {\n    let mut seen = HashMap::new();\n    vec![0, 1]\n  }\n}`,
  Go: `func twoSum(nums []int, target int) []int {\n  seen := make(map[int]int)\n  return []int{0, 1}\n}`,
} as const;

describe('interview code language detection', () => {
  it.each(Object.entries(snippets))('detects %s interview snippets', (language, code) => {
    expect(detectLanguage(code)).toBe(language);
  });

  it('re-detects when the entire snippet is replaced', () => {
    expect(detectLanguage(snippets.Python)).toBe('Python');
    expect(detectLanguage(snippets.Java)).toBe('Java');
    expect(detectLanguage(snippets['C/C++'])).toBe('C/C++');
  });
});
