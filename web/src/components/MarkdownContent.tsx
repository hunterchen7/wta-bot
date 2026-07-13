import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components = {
  h1: (props: ComponentPropsWithoutRef<'h1'>) => <h1 className="mb-4 mt-8 text-2xl font-black tracking-tight text-foreground first:mt-0" {...props} />,
  h2: (props: ComponentPropsWithoutRef<'h2'>) => <h2 className="mb-3 mt-8 text-xl font-black tracking-tight text-foreground first:mt-0" {...props} />,
  h3: (props: ComponentPropsWithoutRef<'h3'>) => <h3 className="mb-2 mt-6 text-base font-black text-foreground" {...props} />,
  p: (props: ComponentPropsWithoutRef<'p'>) => <p className="my-3 leading-7 text-muted-foreground first:mt-0 last:mb-0" {...props} />,
  ul: (props: ComponentPropsWithoutRef<'ul'>) => <ul className="my-4 list-disc space-y-2 pl-6 text-muted-foreground" {...props} />,
  ol: (props: ComponentPropsWithoutRef<'ol'>) => <ol className="my-4 list-decimal space-y-2 pl-6 text-muted-foreground" {...props} />,
  li: (props: ComponentPropsWithoutRef<'li'>) => <li className="pl-1 leading-7" {...props} />,
  blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) => <blockquote className="my-5 border-l-4 border-western-400 bg-western-50 px-5 py-3 text-muted-foreground dark:bg-western-950/30" {...props} />,
  pre: (props: ComponentPropsWithoutRef<'pre'>) => <pre className="my-5 max-w-full overflow-x-auto rounded-xl border border-border bg-slate-950 p-4 text-sm leading-6 text-slate-100" {...props} />,
  code: ({ className, ...props }: ComponentPropsWithoutRef<'code'>) => className
    ? <code className={className} {...props} />
    : <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground" {...props} />,
  a: (props: ComponentPropsWithoutRef<'a'>) => <a className="font-bold text-western-700 underline decoration-western-300 underline-offset-4 hover:text-western-900 dark:text-western-300 dark:hover:text-western-200" target="_blank" rel="noreferrer" {...props} />,
  hr: (props: ComponentPropsWithoutRef<'hr'>) => <hr className="my-8 border-border" {...props} />,
  table: (props: ComponentPropsWithoutRef<'table'>) => <div className="my-5 overflow-x-auto rounded-xl border border-border"><table className="w-full border-collapse text-left text-sm" {...props} /></div>,
  th: (props: ComponentPropsWithoutRef<'th'>) => <th className="border-b border-border bg-muted px-4 py-3 font-black text-foreground" {...props} />,
  td: (props: ComponentPropsWithoutRef<'td'>) => <td className="border-b border-border px-4 py-3 text-muted-foreground last:border-b-0" {...props} />,
};

export function MarkdownContent({ children, className = '' }: { children: string; className?: string }) {
  return <div className={`min-w-0 text-sm ${className}`}><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown></div>;
}
