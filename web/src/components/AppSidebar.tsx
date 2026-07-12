import { useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { DashboardData } from '../api';
import { Icon, type IconName } from './Icon';
import { preloadAdminRoute } from '../admin-routes';

type SidebarProps = {
  data: DashboardData;
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onCloseMobile: () => void;
};

type NavEntry = { label: string; to: string; icon: IconName; end?: boolean };

const personalItems: NavEntry[] = [
  { label: 'My progress', to: '/app', icon: 'progress', end: true },
  { label: 'My settings', to: '/app/settings', icon: 'settings' },
];

const adminItems: NavEntry[] = [
  { label: 'Overview', to: '/app/admin', icon: 'overview', end: true },
  { label: 'Participants', to: '/app/admin/participants', icon: 'participants' },
  { label: 'Rounds', to: '/app/admin/rounds', icon: 'rounds' },
  { label: 'Reviews', to: '/app/admin/reviews', icon: 'reviews' },
  { label: 'Forms', to: '/app/admin/forms', icon: 'forms' },
  { label: 'Problems', to: '/app/admin/problems', icon: 'problems' },
  { label: 'Analytics', to: '/app/admin/analytics', icon: 'analytics' },
  { label: 'Operations', to: '/app/admin/operations', icon: 'operations' },
  { label: 'Program settings', to: '/app/admin/settings', icon: 'settings' },
];

export function AppSidebar(props: SidebarProps) {
  const location = useLocation();

  useEffect(() => props.onCloseMobile(), [location.pathname]);
  useEffect(() => {
    if (!props.mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && props.onCloseMobile();
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [props.mobileOpen]);

  return (
    <>
      <aside className="sticky top-0 hidden h-screen min-w-0 border-r border-white/10 bg-slate-950 text-slate-200 md:flex md:flex-col">
        <SidebarContents {...props} mobile={false} />
      </aside>
      <div className={`fixed inset-0 z-50 md:hidden ${props.mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-hidden={!props.mobileOpen}>
        <button aria-label="Dismiss navigation" className={`absolute inset-0 bg-slate-950/55 backdrop-blur-sm transition-opacity ${props.mobileOpen ? 'opacity-100' : 'opacity-0'}`} onClick={props.onCloseMobile} />
        <aside className={`relative flex h-full w-[18rem] max-w-[86vw] flex-col bg-slate-950 text-slate-200 shadow-2xl transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] ${props.mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <SidebarContents {...props} collapsed={false} mobile />
        </aside>
      </div>
    </>
  );
}

function SidebarContents({ data, collapsed, mobile, onCollapse, onCloseMobile }: SidebarProps & { mobile: boolean }) {
  return (
    <>
      <div className={`flex h-18 shrink-0 items-center border-b border-white/10 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
        <NavLink to="/app" className="flex min-w-0 items-center gap-3 font-black tracking-tight text-white" onClick={onCloseMobile}>
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-400 text-sm text-slate-950 shadow-lg shadow-emerald-500/15">WTA</span>
          {!collapsed ? <span className="truncate">Mock Interviews</span> : null}
        </NavLink>
        {mobile ? <button aria-label="Close navigation" className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white" onClick={onCloseMobile}><Icon name="close" /></button> : !collapsed ? <button aria-label="Collapse sidebar" className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white" onClick={onCollapse}><Icon name="collapse" /></button> : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4 [scrollbar-gutter:stable]">
        <NavGroup label="Personal" items={personalItems} collapsed={collapsed} onNavigate={onCloseMobile} />
        {data.viewer.organizer ? <NavGroup label="Admin" items={adminItems} collapsed={collapsed} onNavigate={onCloseMobile} className="mt-6" /> : null}
      </nav>

      <div className="shrink-0 border-t border-white/10 p-3">
        {collapsed ? (
          <div className="grid place-items-center" title={`${data.participant.name} · ${data.participant.preferredEmail}`}><Avatar name={data.participant.name} /></div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3"><Avatar name={data.participant.name} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-white">{data.participant.name}</div><div className="truncate text-xs text-slate-400">{data.participant.discordUsername ? `@${data.participant.discordUsername}` : data.participant.preferredEmail}</div></div></div>
        )}
        {!mobile && collapsed ? <button aria-label="Expand sidebar" className="mt-3 grid w-full place-items-center rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white" onClick={onCollapse}><Icon name="chevron" /></button> : null}
      </div>
    </>
  );
}

function NavGroup({ label, items, collapsed, onNavigate, className = '' }: { label: string; items: NavEntry[]; collapsed: boolean; onNavigate: () => void; className?: string }) {
  return <section className={className}>{!collapsed ? <div className="px-3 pb-2 text-[0.66rem] font-black uppercase tracking-[0.2em] text-slate-500">{label}</div> : <div className="mx-2 mb-3 border-t border-white/10" />}{items.map((item) => <SidebarLink key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />)}</section>;
}

function SidebarLink({ item, collapsed, onNavigate }: { item: NavEntry; collapsed: boolean; onNavigate: () => void }) {
  const location = useLocation();
  const active = item.end ? location.pathname === item.to : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
  const preload = () => preloadAdminRoute(item.to);
  return <Link to={item.to} aria-current={active ? 'page' : undefined} title={collapsed ? item.label : undefined} onPointerEnter={preload} onPointerDown={preload} onFocus={preload} onClick={onNavigate} className={`mb-1 flex h-11 items-center rounded-xl text-sm font-semibold transition ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} ${active ? 'bg-emerald-400/15 text-emerald-300' : 'text-slate-400 hover:bg-white/7 hover:text-white'}`}><Icon name={item.icon} className="size-5 shrink-0" />{!collapsed ? <span className="truncate">{item.label}</span> : null}</Link>;
}

function Avatar({ name }: { name: string }) {
  const value = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  return <span className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-800 text-xs font-black text-emerald-300">{value}</span>;
}
