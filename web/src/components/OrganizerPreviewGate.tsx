import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

type Access = 'checking' | 'allowed' | 'participant' | 'anonymous' | 'error';

export function OrganizerPreviewGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>('checking');
  const location = useLocation();

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/session', { headers: { Accept: 'application/json' }, signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return setAccess('anonymous');
        if (!response.ok) return setAccess('error');
        const session = await response.json() as { organizer?: boolean };
        setAccess(session.organizer ? 'allowed' : 'participant');
      })
      .catch((error) => { if (error?.name !== 'AbortError') setAccess('error'); });
    return () => controller.abort();
  }, []);

  if (access === 'anonymous') {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (access === 'participant') return <Navigate to="/app" replace />;
  if (access === 'error') return <main className="grid min-h-screen place-items-center bg-background p-6"><div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center text-card-foreground"><h1 className="text-lg font-black">Couldn’t verify organizer access</h1><p className="mt-2 text-sm text-muted-foreground">Reload the page or return to the dashboard.</p></div></main>;
  if (access === 'checking') return <main className="min-h-screen animate-pulse bg-background p-6"><div className="mx-auto h-96 max-w-3xl rounded-3xl bg-muted" /></main>;
  return children;
}
