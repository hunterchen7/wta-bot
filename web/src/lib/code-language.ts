export type SupportedLanguage = 'Python' | 'Java' | 'JavaScript/TypeScript' | 'C/C++' | 'Rust' | 'Go' | 'Other';
type LanguageSignal = [pattern: RegExp, weight: number];

const languageSignals: Array<[SupportedLanguage, LanguageSignal[]]> = [
  ['Python', [
    [/\bdef\s+\w+\s*\(/g, 4], [/^\s*(?:if|for|while|def|class).*:\s*$/gm, 2],
    [/\b(?:from|import)\s+[\w.]+/g, 2], [/\b(?:elif|None|True|False|self)\b/g, 1],
  ]],
  ['Java', [
    [/\b(?:public|private|protected)\s+(?:static\s+)?[\w.?]+(?:<[^;{}()]+>)?(?:\[\])?\s+\w+\s*\(/g, 4],
    [/\bnew\s+[A-Z]\w*(?:<[^;{}]*>)?\s*\(/g, 2], [/\b(?:Map|List|Set|HashMap|ArrayList|String|Integer|Boolean)\s*</g, 2],
    [/\bnew\s+(?:int|long|double|boolean|char|String)\s*\[/g, 2], [/\bSystem\.out\./g, 3],
  ]],
  ['JavaScript/TypeScript', [
    [/\b(?:const|let|var)\s+[$\w]+/g, 2], [/=>/g, 3], [/\bfunction\s+\w+\s*\(/g, 4],
    [/\bconsole\.log\b/g, 3], [/\b(?:interface|type)\s+\w+/g, 3], [/\.(?:push|map|filter|reduce)\s*\(/g, 1],
  ]],
  ['C/C++', [
    [/#include\s*[<"]/g, 4], [/\bstd::/g, 3], [/\b(?:vector|string|unordered_map|unordered_set|map|set)\s*</g, 2],
    [/^\s*(?:public|private|protected):\s*$/gm, 3], [/\b(?:cout|cin)\s*(?:<<|>>)/g, 3], [/\b(?:nullptr|push_back|size_t)\b/g, 2],
  ]],
  ['Rust', [
    [/\b(?:pub\s+)?fn\s+\w+\s*\(/g, 4], [/\blet\s+(?:mut\s+)?\w+/g, 2], [/\bVec\s*</g, 2],
    [/\b(?:impl|trait)\s+\w+/g, 2], [/\bprintln!\s*\(/g, 3], [/\b\w+::(?:new|with_capacity)\s*\(/g, 2],
  ]],
  ['Go', [
    [/\bfunc\s+(?:\([^)]*\)\s*)?\w+\s*\(/g, 4], [/\bpackage\s+\w+/g, 3], [/\b\w+\s*:=/g, 3],
    [/\bmake\s*\(\s*(?:map|\[\]|chan)/g, 2], [/\[\](?:int|string|byte|rune|bool)\b/g, 2], [/\bfmt\.(?:Print|Scan)/g, 3],
  ]],
];

export function detectLanguage(code: string): SupportedLanguage | null {
  if (code.trim().length < 12) return null;
  const scores = languageSignals.map(([language, signals]) => [language, score(code, signals)] as [SupportedLanguage, number]);
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0]![1] >= 3 && scores[0]![1] > scores[1]![1] ? scores[0]![0] : null;
}

function score(code: string, signals: LanguageSignal[]) {
  return signals.reduce((total, [pattern, weight]) => total + Math.min(code.match(pattern)?.length ?? 0, 3) * weight, 0);
}
