import { createContext, useContext } from 'react';
import type { DashboardData } from './api';

export type DashboardContextValue = { data: DashboardData; refresh: (options?: { silent?: boolean }) => Promise<void> };
export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value) throw new Error('Dashboard context missing');
  return value;
}
