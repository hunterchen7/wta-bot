import { lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppLayout } from './App';
import { adminRouteModules } from './admin-routes';
import { ProgressPage } from './pages/ProgressPage';
import { SettingsPage } from './pages/SettingsPage';
import './styles.css';

const OperationsPage = lazy(adminRouteModules.operations);
const FormsPage = lazy(adminRouteModules.forms);
const ProblemsPage = lazy(adminRouteModules.problems);
const ParticipantsPage = lazy(adminRouteModules.participants);
const OverviewPage = lazy(adminRouteModules.overview);
const RoundsPage = lazy(adminRouteModules.rounds);
const ReviewsPage = lazy(adminRouteModules.reviews);
const AnalyticsPage = lazy(adminRouteModules.analytics);
const AdminSettingsPage = lazy(adminRouteModules.settings);
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const ReportPage = lazy(() => import('./pages/ReportPage').then((module) => ({ default: module.ReportPage })));
const ProblemPage = lazy(() => import('./pages/ProblemPage').then((module) => ({ default: module.ProblemPage })));
const BankPage = lazy(() => import('./pages/BankPage').then((module) => ({ default: module.BankPage })));
const PreviewPage = lazy(() => import('./pages/PreviewPage').then((module) => ({ default: module.PreviewPage })));
const EnrollmentPage = lazy(() => import('./pages/EnrollmentPage').then((module) => ({ default: module.EnrollmentPage })));
const deferred = (page: ReactNode) => <Suspense fallback={<div className="h-80 animate-pulse rounded-2xl bg-slate-200/70" />}>{page}</Suspense>;
const publicDeferred = (page: ReactNode) => <Suspense fallback={<div className="min-h-screen animate-pulse bg-stone-50 p-6"><div className="mx-auto h-96 max-w-3xl rounded-3xl bg-slate-200/70" /></div>}>{page}</Suspense>;

const router = createBrowserRouter(
  [
    { path: '/', element: <Navigate to="/login" replace /> },
    { path: '/login', element: publicDeferred(<LoginPage />) },
    { path: '/bank', element: publicDeferred(<BankPage />) },
    { path: '/preview', element: publicDeferred(<PreviewPage />) },
    { path: '/preview/form/interviewee_report', element: publicDeferred(<ReportPage previewKind="interviewee_report" />) },
    { path: '/preview/form/interviewer_report', element: publicDeferred(<ReportPage previewKind="interviewer_report" />) },
    { path: '/preview/packet', element: publicDeferred(<ProblemPage preview />) },
    { path: '/preview/enrollment', element: publicDeferred(<EnrollmentPage preview />) },
    { path: '/f/:token', element: publicDeferred(<ReportPage />) },
    { path: '/p/:token', element: publicDeferred(<ProblemPage />) },
    { path: '/enroll/:token', element: publicDeferred(<EnrollmentPage />) },
    {
      path: '/app',
      element: <AppLayout />,
      children: [
        { index: true, element: <ProgressPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: 'admin', element: deferred(<OverviewPage />) },
        { path: 'admin/participants', element: deferred(<ParticipantsPage />) },
        { path: 'admin/rounds', element: deferred(<RoundsPage />) },
        { path: 'admin/reviews', element: deferred(<ReviewsPage />) },
        { path: 'admin/forms', element: deferred(<FormsPage />) },
        { path: 'admin/problems', element: deferred(<ProblemsPage />) },
        { path: 'admin/analytics', element: deferred(<AnalyticsPage />) },
        { path: 'admin/operations', element: deferred(<OperationsPage />) },
        { path: 'admin/settings', element: deferred(<AdminSettingsPage />) },
      ],
    },
  ],
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
