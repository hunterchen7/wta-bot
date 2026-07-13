import { preloadAdminData } from './hooks/useAdminData';

export const adminRouteModules = {
  overview: () => import('./pages/admin/OverviewPage').then((module) => ({ default: module.OverviewPage })),
  participants: () => import('./pages/admin/ParticipantsPage').then((module) => ({ default: module.ParticipantsPage })),
  rounds: () => import('./pages/admin/RoundsPage').then((module) => ({ default: module.RoundsPage })),
  reviews: () => import('./pages/admin/ReviewsPage').then((module) => ({ default: module.ReviewsPage })),
  forms: () => import('./pages/admin/FormsPage').then((module) => ({ default: module.FormsPage })),
  problems: () => import('./pages/admin/ProblemsPage').then((module) => ({ default: module.ProblemsPage })),
  analytics: () => import('./pages/admin/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })),
  operations: () => import('./pages/admin/OperationsPage').then((module) => ({ default: module.OperationsPage })),
  settings: () => import('./pages/admin/AdminSettingsPage').then((module) => ({ default: module.AdminSettingsPage })),
  mcp: () => import('./pages/admin/McpPage').then((module) => ({ default: module.McpPage })),
};

const routes = {
  '/app/admin': { module: adminRouteModules.overview, data: '/overview' },
  '/app/admin/participants': { module: adminRouteModules.participants, data: '/participants' },
  '/app/admin/rounds': { module: adminRouteModules.rounds, data: '/rounds' },
  '/app/admin/reviews': { module: adminRouteModules.reviews, data: '/reviews' },
  '/app/admin/forms': { module: adminRouteModules.forms, data: null },
  '/app/admin/problems': { module: adminRouteModules.problems, data: '/problems' },
  '/app/admin/analytics': { module: adminRouteModules.analytics, data: '/analytics' },
  '/app/admin/operations': { module: adminRouteModules.operations, data: '/operations' },
  '/app/admin/settings': { module: adminRouteModules.settings, data: '/settings' },
  '/app/admin/mcp': { module: adminRouteModules.mcp, data: '/mcp-token' },
} as const;

export function preloadAdminRoute(pathname: string) {
  const route = routes[pathname as keyof typeof routes];
  if (!route) return;
  void route.module();
  if (route.data) preloadAdminData(route.data);
}

export function preloadAllAdminModules() {
  for (const load of Object.values(adminRouteModules)) void load();
}
