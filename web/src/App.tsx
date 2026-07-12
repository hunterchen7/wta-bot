import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { getDashboard, logout, type DashboardData } from './api';
import { AppSidebar } from './components/AppSidebar';
import { Icon } from './components/Icon';
import { ThemeToggle } from './components/ThemeToggle';
import { DashboardContext } from './dashboard-context';

export function AppLayout() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readInitialSidebarState);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const refresh = useCallback(async () => {
    try {
      setData(await getDashboard());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the dashboard.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (error) {
    return <main className="grid min-h-screen place-items-center p-6"><div className="max-w-md rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm"><p className="text-lg font-semibold text-rose-700">{error}</p><button className="mt-5 rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white" onClick={() => void refresh()}>Try again</button></div></main>;
  }
  if (!data) return <LoadingShell />;

  const toggleSidebar = () => setSidebarCollapsed((current) => {
    const next = !current;
    try { localStorage.setItem('wta:sidebar-collapsed', String(next)); } catch { /* storage unavailable */ }
    return next;
  });

  return (
    <DashboardContext.Provider value={{ data, refresh }}>
      <div className={`min-h-screen bg-[#f7f7f5] transition-[grid-template-columns] duration-200 ease-[cubic-bezier(.22,1,.36,1)] dark:bg-background md:grid ${sidebarCollapsed ? 'md:grid-cols-[5rem_minmax(0,1fr)]' : 'md:grid-cols-[16rem_minmax(0,1fr)]'}`}>
        <AppSidebar data={data} collapsed={sidebarCollapsed} mobileOpen={mobileOpen} onCollapse={toggleSidebar} onCloseMobile={() => setMobileOpen(false)} />
        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl dark:border-border dark:bg-background/90 sm:px-6">
            <button aria-label="Open navigation" className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 shadow-sm md:hidden" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-slate-900">{pageTitle(location.pathname)}</div><div className="hidden truncate text-xs text-slate-500 sm:block">Western Tech Alumni mock interview program</div></div>
            <div className="hidden text-right lg:block"><div className="text-sm font-semibold text-slate-900">{data.participant.name}</div><div className="text-xs text-slate-500">{data.viewer.organizer ? 'Organizer' : 'Participant'}</div></div>
            <ThemeToggle />
            <button onClick={() => void logout()} className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50">Log out</button>
          </header>
          <main className="mx-auto w-full max-w-[100rem] px-4 py-8 sm:px-6 sm:py-10 lg:px-8"><div key={location.pathname} className="route-enter"><Outlet /></div></main>
        </div>
      </div>
    </DashboardContext.Provider>
  );
}

function readInitialSidebarState() {
  try {
    const saved = localStorage.getItem('wta:sidebar-collapsed');
    if (saved !== null) return saved === 'true';
    return !window.matchMedia('(min-width: 1280px)').matches;
  } catch {
    return false;
  }
}

function pageTitle(pathname: string) {
  const titles: Record<string, string> = {
    '/app': 'My progress', '/app/settings': 'My settings', '/app/admin': 'Overview',
    '/app/admin/participants': 'Participants', '/app/admin/rounds': 'Rounds', '/app/admin/reviews': 'Reviews',
    '/app/admin/forms': 'Forms', '/app/admin/problems': 'Problems', '/app/admin/analytics': 'Analytics', '/app/admin/operations': 'Operations',
    '/app/admin/settings': 'Program settings',
  };
  return titles[pathname] ?? 'WTA Dashboard';
}

function LoadingShell() {
  return <div className="min-h-screen bg-slate-950 md:grid md:grid-cols-[16rem_minmax(0,1fr)]"><div className="hidden border-r border-white/10 md:block" /><div className="animate-pulse bg-stone-50 px-6 py-12"><div className="h-10 w-64 rounded-xl bg-slate-200" /><div className="mt-8 grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-36 rounded-3xl bg-slate-200" />)}</div></div></div>;
}
