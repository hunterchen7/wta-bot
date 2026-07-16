/**
 * Safe walkthrough content for screenshots and organizer demos.
 *
 * This packet deliberately lives outside the `problems` table and is never
 * eligible for a week set, session assignment, or participant exposure. A
 * signed `demo:fizzbuzz` token is the only way to request it.
 */
export const fizzBuzzDemoPacket = {
  mode: 'packet' as const,
  round: 1,
  scheduledAt: null,
  intervieweeName: 'Ethan',
  problem: {
    number: null,
    title: 'FizzBuzz',
    url: null,
    difficulty: 'easy',
    statement: `Write a function that returns the values from \`1\` through \`n\` in order, with the following substitutions:

- For multiples of \`3\`, return \`"Fizz"\` instead of the number.
- For multiples of \`5\`, return \`"Buzz"\` instead of the number.
- For multiples of both \`3\` and \`5\`, return \`"FizzBuzz"\`.
- Otherwise, return the number as a string.

### Function signature

\`fizzBuzz(n: number): string[]\`

### Example

\`\`\`text
Input:  n = 16
Output: ["1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz", "11", "Fizz", "13", "14", "FizzBuzz", "16"]
\`\`\`

### Constraints

- \`1 <= n <= 10,000\`
- The result must contain exactly \`n\` entries.
- Preserve the original numeric order.`,
    hints: `1. **Start with the combined case.** A number divisible by both \`3\` and \`5\` is divisible by \`15\`. Why should this check come before the individual checks?
2. **Use remainders.** \`value % divisor === 0\` tells you that \`value\` is divisible by \`divisor\`.
3. **Build one answer per number.** Iterate from \`1\` through \`n\`, choose the appropriate string, and append it to the result.`,
    solution: `Visit every integer from \`1\` through \`n\` exactly once.

For each value:

1. Check divisibility by \`15\` first and append \`"FizzBuzz"\`.
2. Otherwise, check divisibility by \`3\` and append \`"Fizz"\`.
3. Otherwise, check divisibility by \`5\` and append \`"Buzz"\`.
4. If none match, append the number converted to a string.

Checking the combined case first is essential. If the code checks \`3\` first, a multiple of \`15\` would be labelled only \`"Fizz"\` and the later checks would never run.

### Reference implementation

\`\`\`typescript
function fizzBuzz(n: number): string[] {
  const result: string[] = [];

  for (let value = 1; value <= n; value += 1) {
    if (value % 15 === 0) {
      result.push("FizzBuzz");
    } else if (value % 3 === 0) {
      result.push("Fizz");
    } else if (value % 5 === 0) {
      result.push("Buzz");
    } else {
      result.push(String(value));
    }
  }

  return result;
}
\`\`\`

### Why it works

The loop produces one output for every value in the required range. The mutually exclusive checks cover all four possible cases, and their order ensures a number divisible by both \`3\` and \`5\` receives the combined label.

### Complexity

- **Time:** \`O(n)\`, because each number is examined once.
- **Extra space:** \`O(n)\` for the returned array. Excluding the output, the algorithm uses \`O(1)\` auxiliary space.`,
  },
};

