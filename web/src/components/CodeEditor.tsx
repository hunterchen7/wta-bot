import { useMemo, useState, type UIEvent } from 'react';
import { Textarea } from './ui/textarea';
import { detectLanguage, type SupportedLanguage } from '../lib/code-language';

type Token = { text: string; kind?: 'comment' | 'string' | 'number' | 'keyword' | 'type' | 'literal' | 'function' };

const tokenColors: Record<NonNullable<Token['kind']>, string> = {
  comment: 'text-slate-500', string: 'text-amber-300', number: 'text-orange-300', keyword: 'text-fuchsia-300',
  type: 'text-cyan-300', literal: 'text-violet-300', function: 'text-emerald-300',
};

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

export function CodeEditor({ value, invalid, onChange }: { value: string; invalid?: boolean; onChange: (value: string) => void }) {
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const resolvedLanguage = useMemo(() => detectLanguage(value) ?? 'Other', [value]);
  const tokens = useMemo(() => highlight(value, resolvedLanguage), [value, resolvedLanguage]);

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });

  return <div className={`overflow-hidden rounded-xl border bg-[#0b1020] shadow-sm ${invalid ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-700'}`}>
    <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400"><span>Code</span><span className="rounded-full bg-white/8 px-2 py-1 text-slate-300">{resolvedLanguage === 'Other' ? 'Plain text' : resolvedLanguage}</span></div>
    <div className="relative h-96">
      <pre aria-hidden="true" className="pointer-events-none absolute inset-0 m-0 overflow-hidden p-4 font-mono text-[0.8rem] leading-6 whitespace-pre text-slate-200" style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>{tokens.map((token, index) => <span className={token.kind ? tokenColors[token.kind] : undefined} key={`${index}-${token.text.length}`}>{token.text}</span>)}{value.endsWith('\n') ? '\n' : null}</pre>
      <Textarea aria-invalid={invalid} aria-label="Interview code" required value={value} onChange={(event) => onChange(event.target.value)} onScroll={syncScroll} wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" className="relative z-10 h-full min-h-0 max-h-full field-sizing-fixed resize-none overflow-auto rounded-none border-0 bg-transparent p-4 font-mono text-[0.8rem] leading-6 whitespace-pre text-transparent caret-white shadow-none selection:bg-emerald-400/35 focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent" />
    </div>
  </div>;
}

function highlight(code: string, language: SupportedLanguage): Token[] {
  const tokens: Token[] = [];
  const pattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b|\b[A-Za-z_$][\w$]*\b)/gi;
  let cursor = 0;
  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ text: code.slice(cursor, index) });
    const text = match[0];
    const first = text[0];
    let kind: Token['kind'];
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
