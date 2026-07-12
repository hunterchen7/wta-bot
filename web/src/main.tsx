import { lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppLayout } from './App';
import { ProgressPage } from './pages/ProgressPage';
import { SettingsPage } from './pages/SettingsPage';
import { OverviewPage } from './pages/admin/OverviewPage';
import { ParticipantsPage } from './pages/admin/ParticipantsPage';
import { RoundsPage } from './pages/admin/RoundsPage';
import { ReviewsPage } from './pages/admin/ReviewsPage';
import { ProblemsPage } from './pages/admin/ProblemsPage';
import { AnalyticsPage } from './pages/admin/AnalyticsPage';
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage';
import { LoginPage } from './pages/LoginPage';
import { ReportPage } from './pages/ReportPage';
import { ProblemPage } from './pages/ProblemPage';
import { BankPage } from './pages/BankPage';
import { PreviewPage } from './pages/PreviewPage';
import { EnrollmentPage } from './pages/EnrollmentPage';
import './styles.css';

const OperationsPage = lazy(() => import('./pages/admin/OperationsPage').then((module) => ({ default: module.OperationsPage })));
const FormsPage = lazy(() => import('./pages/admin/FormsPage').then((module) => ({ default: module.FormsPage })));
const deferred = (page: ReactNode) => <Suspense fallback={<div className="h-80 animate-pulse rounded-2xl bg-slate-200/70" />}>{page}</Suspense>;

const router = createBrowserRouter(
  [
    { path: '/', element: <Navigate to="/login" replace /> },
    { path: '/login', element: <LoginPage /> },
    { path: '/bank', element: <BankPage /> },
    { path: '/preview', element: <PreviewPage /> },
    { path: '/preview/form/interviewee_report', element: <ReportPage previewKind="interviewee_report" /> },
    { path: '/preview/form/interviewer_report', element: <ReportPage previewKind="interviewer_report" /> },
    { path: '/preview/packet', element: <ProblemPage preview /> },
    { path: '/preview/enrollment', element: <EnrollmentPage preview /> },
    { path: '/f/:token', element: <ReportPage /> },
    { path: '/p/:token', element: <ProblemPage /> },
    { path: '/enroll/:token', element: <EnrollmentPage /> },
    {
      path: '/app',
      element: <AppLayout />,
      children: [
        { index: true, element: <ProgressPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: 'admin', element: <OverviewPage /> },
        { path: 'admin/participants', element: <ParticipantsPage /> },
        { path: 'admin/rounds', element: <RoundsPage /> },
        { path: 'admin/reviews', element: <ReviewsPage /> },
        { path: 'admin/forms', element: deferred(<FormsPage />) },
        { path: 'admin/problems', element: <ProblemsPage /> },
        { path: 'admin/analytics', element: <AnalyticsPage /> },
        { path: 'admin/operations', element: deferred(<OperationsPage />) },
        { path: 'admin/settings', element: <AdminSettingsPage /> },
      ],
    },
  ],
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
