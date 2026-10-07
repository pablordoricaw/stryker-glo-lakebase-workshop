/**
 * Top-level router + layout.
 *
 * Each route maps to one "section" of the demo — see the folder names:
 *   home/       — the narrative landing page
 *   chat/       — the Assistant (conversations + streaming + thinking panel)
 *   operations/ — OLTP workflow (returns queue, lot cards, decision drawer)
 *   analytics/  — warehouse-backed charts
 *   dashboard/  — embedded AI/BI dashboard iframe
 *   platform/   — Databricks Data + AI pitch page
 *
 * Chrome (Stryker corporate strip + yellow nav + header) lives in shell/.
 */
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router';

import { StrykerCorpBar } from '@/shell/StrykerCorpBar';
import { AppNavBar } from '@/shell/AppNavBar';
import { AppHeader } from '@/shell/AppHeader';
import { HomeView } from '@/home/HomeView';
import { ChatView } from '@/chat/ChatView';
import { ChatDock } from '@/chat/ChatDock';
import { OperationsView } from '@/operations/OperationsView';
import { AnalyticsView } from '@/analytics/AnalyticsView';
import { DashboardView } from '@/dashboard/DashboardView';
import { PlatformView } from '@/platform/PlatformView';
import { SessionProvider } from '@/lib/api';
import { RouteError } from './RouteError';

function Layout() {
  // SessionProvider wraps everything so /api/me and /api/config are
  // fetched ONCE here and consumed via `useSession()` by AppHeader,
  // AppNavBar, HomeView, ChatDock, ChatView, OperationsView, etc.
  // (Previously each component fetched independently — 8-10 redundant
  // requests on every page load.)
  return (
    <SessionProvider>
      {/* Top-nav layout: Stryker corporate strip → yellow app nav → filter/utility
          bar → content. (Replaces the former left sidebar; the assistant lives
          in ChatDock.) */}
      <div className="flex min-h-svh w-full flex-col bg-background">
        <StrykerCorpBar />
        <AppNavBar />
        <AppHeader />
        <main className="relative flex w-full flex-1 flex-col min-h-0">
          <Outlet />
        </main>
      </div>
      <ChatDock />
    </SessionProvider>
  );
}

// When this app runs inside the Demo Prompt Generator's preview proxy, a
// client-side shim publishes `window.__PREVIEW_BASENAME__` (e.g.
// "/preview/<project-id>"). Passing it as `basename` tells react-router to
// strip that prefix before matching routes. Outside the proxy it's undefined
// and the router behaves normally.
declare global {
  interface Window {
    __PREVIEW_BASENAME__?: string;
  }
}
const PREVIEW_BASENAME =
  typeof window !== 'undefined' ? window.__PREVIEW_BASENAME__ : undefined;

const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      errorElement: <RouteError />,
      children: [
        { path: '/', element: <HomeView /> },
        { path: '/c/:id', element: <ChatView /> },
        { path: '/operations', element: <OperationsView /> },
        { path: '/analytics', element: <AnalyticsView /> },
        { path: '/dashboard', element: <DashboardView /> },
        { path: '/platform', element: <PlatformView /> },
      ],
    },
  ],
  PREVIEW_BASENAME ? { basename: PREVIEW_BASENAME } : undefined,
);

export default function App() {
  return <RouterProvider router={router} />;
}
