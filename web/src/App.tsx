import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { getDashboard, type DashboardData } from './api';

type DashboardContextValue = { data: DashboardData; refresh: () => Promise<void> };
const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value) throw new Error('Dashboard context missing');
  return value;
}

export function AppLayout() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await getDashboard());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the dashboard.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-semibold text-rose-700">{error}</p>
          <button className="mt-5 rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white" onClick={() => void refresh()}>Try again</button>
        </div>
      </main>
    );
  }
  if (!data) return <LoadingShell />;

  return (
    <DashboardContext.Provider value={{ data, refresh }}>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#d9f5e8_0,_transparent_28rem)]">
        <header className="border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4 sm:px-6">
            <NavLink to="/" className="flex items-center gap-3 font-black tracking-tight text-slate-950">
              <span className="grid size-10 place-items-center rounded-2xl bg-emerald-600 text-sm text-white shadow-lg shadow-emerald-600/20">WTA</span>
              <span className="hidden sm:block">Mock Interviews</span>
            </NavLink>
            <nav className="flex flex-1 items-center gap-1">
              <NavItem to="/" end>Progress</NavItem>
              <NavItem to="/settings">Settings</NavItem>
              {data.viewer.organizer ? <a className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100" href="/dashboard/roster">Admin tools ↗</a> : null}
            </nav>
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold text-slate-900">{data.participant.name}</div>
              <div className="text-xs text-slate-500">{data.participant.preferredEmail}</div>
            </div>
            <form method="POST" action="/logout">
              <button className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Log out</button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
          <Outlet />
        </main>
      </div>
    </DashboardContext.Provider>
  );
}

function NavItem({ to, end, children }: { to: string; end?: boolean; children: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `rounded-xl px-3 py-2 text-sm font-semibold transition ${isActive ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {children}
    </NavLink>
  );
}

function LoadingShell() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-6 py-12">
      <div className="h-10 w-64 rounded-xl bg-slate-200" />
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="h-36 rounded-3xl bg-slate-200" />)}
      </div>
    </div>
  );
}
