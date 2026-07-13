import { useMemo, useState, type UIEvent } from 'react';
import { Textarea } from './ui/textarea';
import { detectLanguage } from '../lib/code-language';
import { highlight, tokenClass } from './CodeSyntax';

export function CodeEditor({ value, invalid, onChange }: { value: string; invalid?: boolean; onChange: (value: string) => void }) {
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const resolvedLanguage = useMemo(() => detectLanguage(value) ?? 'Other', [value]);
  const tokens = useMemo(() => highlight(value, resolvedLanguage), [value, resolvedLanguage]);

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });

  return <div className={`overflow-hidden rounded-xl border bg-[#0b1020] shadow-sm ${invalid ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-700'}`}>
    <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400"><span>Code</span><span className="rounded-full bg-white/8 px-2 py-1 text-slate-300">{resolvedLanguage === 'Other' ? 'Plain text' : resolvedLanguage}</span></div>
    <div className="relative h-[48rem] min-h-96 max-h-[90rem] resize-y overflow-hidden">
      <pre aria-hidden="true" className="pointer-events-none absolute inset-0 m-0 p-4 font-mono text-[0.8rem] leading-6 whitespace-pre text-slate-200" style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>{tokens.map((token, index) => <span className={tokenClass(token.kind)} key={`${index}-${token.text.length}`}>{token.text}</span>)}{value.endsWith('\n') ? '\n' : null}</pre>
      <Textarea aria-invalid={invalid} aria-label="Interview code" required value={value} onChange={(event) => onChange(event.target.value)} onScroll={syncScroll} wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" className="relative z-10 h-full min-h-0 max-h-full field-sizing-fixed resize-none overflow-auto rounded-none border-0 bg-transparent p-4 font-mono text-[0.8rem] leading-6 whitespace-pre text-transparent caret-white shadow-none selection:bg-western-400/35 focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent" />
    </div>
  </div>;
}
