import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function ProtectedRoute({ children, allowedRoles }) {
  const auth = useAuth() ?? {};
  const { currentUser, getDefaultRoute, isAuthenticated, isLoading } = auth;
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <span className="section-tag">Carregando</span>
          <h1>Preparando o ambiente da empresa.</h1>
          <p>Estamos validando sua sessão e carregando as informações do workspace.</p>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const fallbackRoute = typeof getDefaultRoute === 'function' ? getDefaultRoute() : '/desempenho';

  if (allowedRoles?.length > 0 && !allowedRoles.includes(currentUser?.role)) {
    return <Navigate to={fallbackRoute} replace state={{ from: location }} />;
  }

  return children;
}
