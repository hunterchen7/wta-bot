import type { ReactNode } from 'react';

export type IconName = 'analytics' | 'chevron' | 'close' | 'collapse' | 'forms' | 'mcp' | 'menu' | 'operations' | 'overview' | 'participants' | 'problems' | 'progress' | 'reviews' | 'rounds' | 'settings';

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    analytics: <><path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M22 19H2" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
    collapse: <><path d="m15 18-6-6 6-6" /><path d="M20 4v16" /></>,
    forms: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h6" /></>,
    mcp: <><path d="M8 12h8" /><path d="M12 8v8" /><path d="M4.9 4.9a10 10 0 0 1 14.2 0" /><path d="M4.9 19.1a10 10 0 0 0 14.2 0" /><circle cx="12" cy="12" r="9" /></>,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    operations: <><path d="M12 2v4" /><path d="M12 18v4" /><path d="m4.93 4.93 2.83 2.83" /><path d="m16.24 16.24 2.83 2.83" /><path d="M2 12h4" /><path d="M18 12h4" /><circle cx="12" cy="12" r="3" /></>,
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    participants: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    problems: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.6 2.6 0 1 1 4 2.2c-.95.6-1.5 1.1-1.5 2.3" /><path d="M12 17h.01" /></>,
    progress: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /></>,
    reviews: <><path d="M9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
    rounds: <><path d="M20 7h-9" /><path d="m16 3 4 4-4 4" /><path d="M4 17h9" /><path d="m8 21-4-4 4-4" /></>,
    settings: <><circle cx="12" cy="12" r="3.5" /><path d="M19 12a7 7 0 0 0-.13-1.34l2-1.56-2-3.46-2.47 1A7 7 0 0 0 14 5.25L13.6 2h-4L9.2 5.25a7 7 0 0 0-2.4 1.39l-2.47-1-2 3.46 2 1.56A7 7 0 0 0 4.2 12c0 .46.04.9.13 1.34l-2 1.56 2 3.46 2.47-1a7 7 0 0 0 2.4 1.39L9.6 22h4l.4-3.25a7 7 0 0 0 2.4-1.39l2.47 1 2-3.46-2-1.56A7 7 0 0 0 19 12Z" /></>,
  };
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
