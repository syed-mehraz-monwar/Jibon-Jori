import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { Toaster } from "./components/ui/Toaster";
import { Spinner } from "./components/ui/Spinner";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { VerifyOtpPage } from "./pages/VerifyOtpPage";

/**
 * B-48: the public pages (landing, sign-in, register, verify, password reset) are eager,
 * because they are the first paint for a new visitor and the auth flow must not wait on a
 * second chunk. The authenticated application pages are loaded on demand, so a visitor who
 * never signs in downloads only the public shell, and a signed-in member downloads one
 * page's code at a time instead of the whole app up front.
 */
const AboutPage = lazy(() => import("./pages/AboutPage").then((m) => ({ default: m.AboutPage })));
const ChatPage = lazy(() => import("./pages/ChatPage").then((m) => ({ default: m.ChatPage })));
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage }))
);
const NotificationsPage = lazy(() =>
  import("./pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage }))
);
const PreferencesPage = lazy(() =>
  import("./pages/PreferencesPage").then((m) => ({ default: m.PreferencesPage }))
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage }))
);
const ProfileViewPage = lazy(() =>
  import("./pages/ProfileViewPage").then((m) => ({ default: m.ProfileViewPage }))
);
const RecommendationsPage = lazy(() =>
  import("./pages/RecommendationsPage").then((m) => ({ default: m.RecommendationsPage }))
);
const ReportsPage = lazy(() =>
  import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage }))
);
const SearchPage = lazy(() => import("./pages/SearchPage").then((m) => ({ default: m.SearchPage })));
const SessionsPage = lazy(() =>
  import("./pages/SessionsPage").then((m) => ({ default: m.SessionsPage }))
);

/**
 * Shown while a route chunk is fetched. It is a labelled, centred spinner rather than a
 * blank frame, so a slow network still communicates that the page is loading. The spinner
 * itself carries `role="status"` with an accessible name, so a screen reader announces it.
 */
function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="h-8 w-8 text-brand-600" />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify" element={<VerifyOtpPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route path="/app" element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="preferences" element={<PreferencesPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="recommendations" element={<RecommendationsPage />} />
            <Route path="profiles/:profileId" element={<ProfileViewPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="about" element={<AboutPage />} />
          </Route>

          <Route path="/app/*" element={<Navigate to="/app" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      <Toaster />
    </ErrorBoundary>
  );
}
