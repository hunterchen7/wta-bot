import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';

export function PublicShell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/session', { headers: { Accept: 'application/json' }, signal: controller.signal })
      .then((response) => setAuthenticated(response.ok))
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setAuthenticated(false);
      });
    return () => controller.abort();
  }, []);

  return <div className="min-h-screen bg-background text-slate-900 dark:bg-background dark:text-foreground">
    <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-border dark:bg-background/90">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to={authenticated ? '/app' : '/'} className="flex items-center gap-3 font-black tracking-tight text-slate-950"><span className="grid size-10 place-items-center rounded-2xl bg-western-950 text-xs text-western-300">WTA</span><span>Mock Interviews</span></Link>
        <nav className="flex items-center gap-1 text-sm font-bold text-slate-600 dark:text-muted-foreground">{authenticated === null ? <span aria-hidden="true" className="mx-3 h-4 w-16 animate-pulse rounded bg-slate-200 dark:bg-muted" /> : <Link className="rounded-lg px-3 py-2 transition-colors hover:bg-slate-100 dark:hover:bg-muted" to={authenticated ? '/app' : '/login'}>{authenticated ? 'Dashboard' : 'Log in'}</Link>}<ThemeToggle /></nav>
      </div>
    </header>
    <main className={`mx-auto px-4 py-10 sm:px-6 sm:py-16 ${narrow ? 'max-w-3xl' : 'max-w-6xl'}`}>{children}</main>
    <footer className="mx-auto max-w-7xl border-t border-slate-200 px-4 py-8 text-xs font-semibold text-slate-400 sm:px-6 dark:border-border dark:text-muted-foreground">Western Tech Alumni · Mock interview program</footer>
  </div>;
}

export function PublicIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="mb-8"><div className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-western-700 dark:text-western-300">{eyebrow}</div><h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 sm:text-5xl dark:text-foreground">{title}</h1><p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 dark:text-muted-foreground">{description}</p></header>;
}

export const publicInputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-western-500 focus:ring-2 focus:ring-western-500/15';
