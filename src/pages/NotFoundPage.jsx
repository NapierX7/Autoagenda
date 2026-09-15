import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function NotFoundPage() {
  const { getDefaultRoute } = useAuth();

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="section-tag">404</span>
        <h1>Página não encontrada.</h1>
        <p>Volte para a área principal do seu perfil e continue a operação.</p>
        <Link to={getDefaultRoute()} className="ghost-link">Voltar para o app</Link>
      </section>
    </main>
  );
}
