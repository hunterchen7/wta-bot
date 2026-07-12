import { useEffect, type ReactNode } from 'react';

export function PageIntro({ eyebrow = 'Admin', title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
    <div className="max-w-3xl"><div className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-emerald-700">{eyebrow}</div><h1 className="mt-2 text-3xl font-black tracking-[-0.035em] text-slate-950 sm:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{description}</p></div>
    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
  </header>;
}

export function Panel({ children, className = '', title, description, actions }: { children: ReactNode; className?: string; title?: string; description?: string; actions?: ReactNode }) {
  return <section className={`overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,.025)] ${className}`}>
    {title || actions ? <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div>{title ? <h2 className="text-sm font-extrabold text-slate-950">{title}</h2> : null}{description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}</div>{actions}</div> : null}
    {children}
  </section>;
}

export function Metric({ label, value, note, tone = 'default' }: { label: string; value: string | number; note?: string; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const tones = { default: 'text-slate-950', good: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-rose-700' };
  return <div className="rounded-2xl border border-slate-200/90 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,.025)]"><div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div><div className={`mt-2 text-3xl font-black tabular-nums tracking-tight ${tones[tone]}`}>{value}</div>{note ? <div className="mt-1 text-xs text-slate-500">{note}</div> : null}</div>;
}

export function Badge({ value }: { value: string | null | undefined }) {
  const normalized = value?.toLowerCase() ?? 'unknown';
  const tone = normalized.includes('active') || normalized.includes('completed') || normalized.includes('verified') || normalized === 'sent' || normalized === 'pass'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : normalized.includes('pending') || normalized.includes('scheduled') || normalized.includes('held') || normalized.includes('borderline')
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : normalized.includes('failed') || normalized.includes('flag') || normalized.includes('broken') || normalized.includes('removed') || normalized === 'ghost'
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-slate-200 bg-slate-50 text-slate-600';
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.68rem] font-extrabold capitalize ${tone}`}>{(value ?? 'unknown').replaceAll('_', ' ')}</span>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="px-6 py-14 text-center"><div className="mx-auto size-2 rounded-full bg-emerald-400 shadow-[0_0_0_6px_rgba(52,211,153,.12)]" /><h3 className="mt-5 text-sm font-extrabold text-slate-900">{title}</h3><p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p></div>;
}

export function LoadingState() {
  return <div aria-label="Loading" className="space-y-4 animate-pulse"><div className="h-24 rounded-2xl bg-slate-200/70" /><div className="grid gap-4 sm:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-28 rounded-2xl bg-slate-200/70" />)}</div><div className="h-80 rounded-2xl bg-slate-200/70" /></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6"><div className="font-extrabold text-rose-900">Couldn’t load this workspace</div><p className="mt-1 text-sm text-rose-700">{message}</p><button className="mt-4 rounded-lg bg-rose-700 px-3 py-2 text-sm font-bold text-white hover:bg-rose-800" onClick={onRetry}>Try again</button></div>;
}

export function Button({ children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'quiet' }) {
  const variants = { primary: 'bg-slate-950 text-white hover:bg-slate-800', secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50', danger: 'bg-rose-700 text-white hover:bg-rose-800', quiet: 'text-slate-600 hover:bg-slate-100' };
  return <button {...props} className={`rounded-lg px-3.5 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}>{children}</button>;
}

export function Tabs({ items, value, onChange }: { items: Array<{ value: string; label: string; count?: number }>; value: string; onChange: (value: string) => void }) {
  return <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100/80 p-1">{items.map((item) => <button aria-label={item.label} key={item.value} onClick={() => onChange(item.value)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${value === item.value ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{item.label}{item.count == null ? null : <span className="ml-1.5 tabular-nums text-slate-400">{item.count}</span>}</button>)}</div>;
}

export function Dialog({ title, description, children, onClose, actions, wide = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; actions?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`max-h-[min(52rem,calc(100vh-2rem))] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-lg'}`}>
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur"><div><h2 id="dialog-title" className="text-lg font-black text-slate-950">{title}</h2>{description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}</div><button aria-label="Close dialog" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button></div>
      <div className="p-5">{children}</div>{actions ? <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">{actions}</div> : null}
    </div>
  </div>;
}

export const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15';
export const tableWrapClass = 'max-w-full overflow-x-auto';
export const tableClass = 'w-full min-w-[42rem] border-collapse text-left text-sm';
export const thClass = 'border-b border-slate-200 bg-slate-50/80 px-4 py-3 text-[0.66rem] font-black uppercase tracking-[0.12em] text-slate-500';
export const tdClass = 'border-b border-slate-100 px-4 py-3 align-middle text-slate-600';

export function formatDate(value: string | null | undefined, withTime = true) {
  if (!value) return '—';
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', withTime ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
