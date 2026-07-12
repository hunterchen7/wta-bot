import { MarkdownContent } from './MarkdownContent';

export function ProblemContentSection({ title, value }: { title: string; value: string }) {
  return <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <h2 className="border-b border-border px-5 py-4 text-sm font-black text-foreground">{title}</h2>
    <MarkdownContent className="p-5 sm:p-6">{value}</MarkdownContent>
  </section>;
}
