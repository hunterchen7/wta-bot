import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppLayout } from './App';
import { ProgressPage } from './pages/ProgressPage';
import { SettingsPage } from './pages/SettingsPage';
import { OverviewPage } from './pages/admin/OverviewPage';
import { ParticipantsPage } from './pages/admin/ParticipantsPage';
import { RoundsPage } from './pages/admin/RoundsPage';
import { ReviewsPage } from './pages/admin/ReviewsPage';
import { ProblemsPage } from './pages/admin/ProblemsPage';
import { AnalyticsPage } from './pages/admin/AnalyticsPage';
import { OperationsPage } from './pages/admin/OperationsPage';
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage';
import './styles.css';

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      children: [
        { index: true, element: <ProgressPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: 'admin', element: <OverviewPage /> },
        { path: 'admin/participants', element: <ParticipantsPage /> },
        { path: 'admin/rounds', element: <RoundsPage /> },
        { path: 'admin/reviews', element: <ReviewsPage /> },
        { path: 'admin/problems', element: <ProblemsPage /> },
        { path: 'admin/analytics', element: <AnalyticsPage /> },
        { path: 'admin/operations', element: <OperationsPage /> },
        { path: 'admin/settings', element: <AdminSettingsPage /> },
      ],
    },
  ],
  { basename: '/app' },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
