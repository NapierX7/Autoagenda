import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/auth/ProtectedRoute';
import AppShell from './components/layout/AppShell';
import { useAuth } from './contexts/AuthContext';
import DashboardPage from './pages/DashboardPage';
import AgendaPage from './pages/AgendaPage';
import HistoryPage from './pages/HistoryPage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import PerformancePage from './pages/PerformancePage';
import UsersPage from './pages/UsersPage';

export default function App() {
  const auth = useAuth() ?? {};
  const { getDefaultRoute, isAuthenticated } = auth;
  const safeDefaultRoute = typeof getDefaultRoute === 'function'
    ? getDefaultRoute()
    : '/dashboard';

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to={safeDefaultRoute} replace /> : <LoginPage />}
      />
      <Route
        element={(
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        )}
      >
        <Route index element={<Navigate to={safeDefaultRoute} replace />} />
        <Route
          path="/dashboard"
          element={(
            <ProtectedRoute allowedRoles={['admin', 'evaluator']}>
              <DashboardPage />
            </ProtectedRoute>
          )}
        />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route
          path="/historico"
          element={(
            <ProtectedRoute allowedRoles={['admin', 'evaluator']}>
              <HistoryPage />
            </ProtectedRoute>
          )}
        />
        <Route path="/desempenho" element={<PerformancePage />} />
        <Route
          path="/usuarios"
          element={(
            <ProtectedRoute allowedRoles={['admin']}>
              <UsersPage />
            </ProtectedRoute>
          )}
        />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
