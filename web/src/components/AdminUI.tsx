import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button as ShadcnButton } from '@/components/ui/button';
import { Badge as ShadcnBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog as ShadcnDialog, DialogClose as ShadcnDialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs as ShadcnTabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function PageIntro({ eyebrow = 'Admin', title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
    <div className="max-w-3xl"><div className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-western-700">{eyebrow}</div><h1 className="mt-2 text-3xl font-black tracking-[-0.035em] text-slate-950 sm:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{description}</p></div>
    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
  </header>;
}

export function Panel({ children, className = '', title, description, actions }: { children: ReactNode; className?: string; title?: string; description?: string; actions?: ReactNode }) {
  return <Card className={`gap-0 overflow-hidden rounded-2xl py-0 shadow-[0_1px_2px_rgba(15,23,42,.025)] ${className}`}>
    {title || actions ? <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div>{title ? <h2 className="text-sm font-extrabold text-slate-950">{title}</h2> : null}{description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}</div>{actions}</div> : null}
    {children}
  </Card>;
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
  return <ShadcnBadge variant="outline" className={`px-2 py-0.5 text-[0.68rem] font-extrabold capitalize ${tone}`}>{(value ?? 'unknown').replaceAll('_', ' ')}</ShadcnBadge>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="px-6 py-14 text-center"><div className="mx-auto size-2 rounded-full bg-western-400 shadow-[0_0_0_6px_rgba(143,85,224,.16)]" /><h3 className="mt-5 text-sm font-extrabold text-slate-900">{title}</h3><p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p></div>;
}

export function LoadingState() {
  return <div aria-label="Loading" className="space-y-4"><Skeleton className="h-24 rounded-2xl" /><div className="grid gap-4 sm:grid-cols-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-28 rounded-2xl" />)}</div><Skeleton className="h-80 rounded-2xl" /></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6"><div className="font-extrabold text-rose-900">Couldn’t load this workspace</div><p className="mt-1 text-sm text-rose-700">{message}</p><button className="mt-4 rounded-lg bg-rose-700 px-3 py-2 text-sm font-bold text-white hover:bg-rose-800" onClick={onRetry}>Try again</button></div>;
}

export function Button({ children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'quiet' }) {
  const variants = { primary: 'default', secondary: 'outline', danger: 'destructive', quiet: 'ghost' } as const;
  return <ShadcnButton {...props} variant={variants[variant]} className={`font-bold ${className}`}>{children}</ShadcnButton>;
}

export function Tabs({ items, value, onChange }: { items: Array<{ value: string; label: string; count?: number }>; value: string; onChange: (value: string) => void }) {
  return <ShadcnTabs value={value} onValueChange={onChange} className="max-w-full overflow-x-auto"><TabsList className="border border-slate-200">{items.map((item) => <TabsTrigger aria-label={item.label} key={item.value} value={item.value} className="text-xs font-extrabold">{item.label}{item.count == null ? null : <span className="ml-1.5 tabular-nums text-slate-400">{item.count}</span>}</TabsTrigger>)}</TabsList></ShadcnTabs>;
}

export function Dialog({ title, description, children, onClose, actions, wide = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; actions?: ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(true);
  const onCloseRef = useRef(onClose);
  const fallbackTimer = useRef<number | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  onCloseRef.current = onClose;

  const finishClose = useCallback(() => {
    if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = null;
    onCloseRef.current();
  }, []);
  const requestClose = useCallback(() => {
    setOpen(false);
    if (fallbackTimer.current === null) fallbackTimer.current = window.setTimeout(finishClose, 250);
  }, [finishClose]);
  useEffect(() => () => {
    if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
  }, []);

  return <ShadcnDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusRef.current?.focus(); }} onAnimationEnd={(event) => { if (!open && event.target === event.currentTarget) finishClose(); }} className={`max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-2xl p-0 shadow-[0_24px_80px_rgba(15,23,42,.3)] [&_[data-slot=dialog-close]]:z-20 ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'}`}>
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-5 py-4 pr-14 backdrop-blur-xl">
          <DialogHeader className="gap-1 text-left">
            <DialogTitle className="font-black text-slate-950">{title}</DialogTitle>
            {description ? <DialogDescription className="text-sm leading-5 text-slate-500">{description}</DialogDescription> : null}
          </DialogHeader>
        </div>
        <div className="p-5">{children}</div>
        {actions ? <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur-xl">{actions}</div> : null}
      </DialogContent>
  </ShadcnDialog>;
}

export function DialogClose({ children }: { children: ReactNode }) {
  return <ShadcnDialogClose asChild>{children}</ShadcnDialogClose>;
}

export const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-western-500 focus:ring-2 focus:ring-western-500/15';
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
