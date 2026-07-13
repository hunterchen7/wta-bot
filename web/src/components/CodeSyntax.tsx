import { useMemo } from 'react';
import type { SupportedLanguage } from '../lib/code-language';

export type CodeToken = { text: string; kind?: 'comment' | 'string' | 'number' | 'keyword' | 'type' | 'literal' | 'function' };

const tokenColors: Record<NonNullable<CodeToken['kind']>, string> = {
  comment: 'text-slate-500', string: 'text-amber-300', number: 'text-orange-300', keyword: 'text-fuchsia-300',
  type: 'text-cyan-300', literal: 'text-violet-300', function: 'text-western-300',
};

export function tokenClass(kind: CodeToken['kind']) {
  return kind ? tokenColors[kind] : undefined;
}

const commonTypes = new Set(['Array', 'Boolean', 'Error', 'List', 'Map', 'Number', 'Object', 'Set', 'String', 'Vec', 'bool', 'byte', 'char', 'double', 'float', 'int', 'long', 'str', 'string', 'void']);
const literals = new Set(['False', 'None', 'True', 'false', 'nil', 'null', 'true', 'undefined']);
const keywords: Record<SupportedLanguage, Set<string>> = {
  Python: new Set('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' ')),
  Java: new Set('abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try volatile while'.split(' ')),
  'JavaScript/TypeScript': new Set('async await break case catch class const continue debugger default delete do else enum export extends finally for from function get if implements import in instanceof interface let new of package private protected public return set static super switch throw try type typeof var void while with yield'.split(' ')),
  'C/C++': new Set('alignas auto break case catch class const constexpr continue default delete do else enum explicit export extern for friend if inline namespace new noexcept operator private protected public register reinterpret_cast return sizeof static struct switch template this throw try typedef typename union using virtual volatile while'.split(' ')),
  Rust: new Set('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'.split(' ')),
  Go: new Set('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'.split(' ')),
  Other: new Set(),
};

export function CodeSyntax({ code, language }: { code: string; language: SupportedLanguage }) {
  const tokens = useMemo(() => highlight(code, language), [code, language]);
  return <pre className="m-0 overflow-x-auto bg-[#0b1020] p-4 font-mono text-[0.8rem] leading-6 whitespace-pre text-slate-200">{tokens.map((token, index) => <span className={tokenClass(token.kind)} key={`${index}-${token.text.length}`}>{token.text}</span>)}{code.endsWith('\n') ? '\n' : null}</pre>;
}

export function highlight(code: string, language: SupportedLanguage): CodeToken[] {
  const tokens: CodeToken[] = [];
  const pattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b|\b[A-Za-z_$][\w$]*\b)/gi;
  let cursor = 0;
  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ text: code.slice(cursor, index) });
    const text = match[0];
    const first = text[0];
    let kind: CodeToken['kind'];
    if (text.startsWith('//') || text.startsWith('/*') || first === '#') kind = 'comment';
    else if (first === '"' || first === "'" || first === '`') kind = 'string';
    else if (/^(?:0x|\d)/i.test(text)) kind = 'number';
    else if (keywords[language].has(text)) kind = 'keyword';
    else if (literals.has(text)) kind = 'literal';
    else if (commonTypes.has(text)) kind = 'type';
    else if (/^\s*\(/.test(code.slice(index + text.length))) kind = 'function';
    tokens.push({ text, kind });
    cursor = index + text.length;
  }
  if (cursor < code.length) tokens.push({ text: code.slice(cursor) });
  return tokens;
}

export function languageFromFence(value: string): SupportedLanguage {
  switch (value.toLowerCase()) {
    case 'py': case 'python': case 'python3': return 'Python';
    case 'java': return 'Java';
    case 'js': case 'jsx': case 'ts': case 'tsx': case 'javascript': case 'typescript': return 'JavaScript/TypeScript';
    case 'c': case 'cc': case 'cpp': case 'cxx': case 'c++': return 'C/C++';
    case 'rs': case 'rust': return 'Rust';
    case 'go': case 'golang': return 'Go';
    default: return 'Other';
  }
}
