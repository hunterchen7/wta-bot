import type { Env } from './env';

export function isWhitelistedAdmin(env: Env, email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (env.DASHBOARD_ADMINS ?? '')
    .split(',')
    .some((entry) => entry.trim().toLowerCase() === normalized);
}
