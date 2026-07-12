import { lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppLayout } from './App';
import { adminRouteModules } from './admin-routes';
import { ProgressPage } from './pages/ProgressPage';
import { SettingsPage } from './pages/SettingsPage';
import { OrganizerPreviewGate } from './components/OrganizerPreviewGate';
import { DocumentTitle } from './components/DocumentTitle';
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
const PracticeProblemsPage = lazy(() => import('./pages/PracticeProblemsPage').then((module) => ({ default: module.PracticeProblemsPage })));
const deferred = (page: ReactNode) => <Suspense fallback={<div className="h-80 animate-pulse rounded-2xl bg-slate-200/70" />}>{page}</Suspense>;
const publicDeferred = (page: ReactNode) => <Suspense fallback={<div className="min-h-screen animate-pulse bg-stone-50 p-6"><div className="mx-auto h-96 max-w-3xl rounded-3xl bg-slate-200/70" /></div>}>{page}</Suspense>;
const titled = (title: string, page: ReactNode) => <><DocumentTitle title={title} />{page}</>;

const router = createBrowserRouter(
  [
    { path: '/', element: <Navigate to="/login" replace /> },
    { path: '/login', element: titled('Sign in', publicDeferred(<LoginPage />)) },
    { path: '/bank', element: titled('Question bank', publicDeferred(<BankPage />)) },
    { path: '/preview', element: titled('Form previews', publicDeferred(<OrganizerPreviewGate><PreviewPage /></OrganizerPreviewGate>)) },
    { path: '/preview/form/interviewee_report', element: titled('Interviewee report preview', publicDeferred(<OrganizerPreviewGate><ReportPage previewKind="interviewee_report" /></OrganizerPreviewGate>)) },
    { path: '/preview/form/interviewer_report', element: titled('Interviewer report preview', publicDeferred(<OrganizerPreviewGate><ReportPage previewKind="interviewer_report" /></OrganizerPreviewGate>)) },
    { path: '/preview/packet', element: titled('Question preview', publicDeferred(<OrganizerPreviewGate><ProblemPage preview /></OrganizerPreviewGate>)) },
    { path: '/preview/enrollment', element: titled('Enrollment preview', publicDeferred(<OrganizerPreviewGate><EnrollmentPage preview /></OrganizerPreviewGate>)) },
    { path: '/f/:token', element: titled('Interview report', publicDeferred(<ReportPage />)) },
    { path: '/p/:token', element: titled('Interview question', publicDeferred(<ProblemPage />)) },
    { path: '/enroll/:token', element: titled('Enrollment', publicDeferred(<EnrollmentPage />)) },
    {
      path: '/app',
      element: <AppLayout />,
      children: [
        { index: true, element: <ProgressPage /> },
        { path: 'practice', element: deferred(<PracticeProblemsPage />) },
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
