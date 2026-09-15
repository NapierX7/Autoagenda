import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import ChangePasswordModal from '../auth/ChangePasswordModal';

function getRoleBadgeLabel(role) {
  if (role === 'admin') return 'Gerente';
  if (role === 'evaluator') return 'Avaliador';
  return 'Vendedor';
}

export default function AppShell() {
  const navigate = useNavigate();
  const { currentUser, isPrivilegedUser, isManager, isSeller, signOut } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);

  const managerLinks = [
    { to: '/dashboard', label: 'Dashboard', icon: '📊' },
    { to: '/agenda', label: 'Agenda', icon: '📅' },
    { to: '/desempenho', label: 'Desempenho', icon: '📈' },
    { to: '/usuarios', label: 'Usuários', icon: '👥' },
    { to: '/historico', label: 'Histórico', icon: '🕘' },
  ];

  const evaluatorLinks = [
    { to: '/dashboard', label: 'Dashboard', icon: '📊' },
    { to: '/agenda', label: 'Agenda', icon: '📅' },
    { to: '/historico', label: 'Histórico', icon: '🕘' },
  ];

  const sellerLinks = [
    { to: '/agenda', label: 'Agenda', icon: '📅' },
    { to: '/desempenho', label: 'Meu desempenho', icon: '📈' },
  ];

  const links = isManager
    ? managerLinks
    : currentUser?.role === 'evaluator'
      ? evaluatorLinks
      : sellerLinks;

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">AutoAgenda</span>
          <h1>Agendamentos de laudos cautelares com visão clara da operação.</h1>
          <p>
            {currentUser.companyName} | Olá, <strong>{currentUser.fullName}</strong>.
            {isSeller && ' Acompanhe sua agenda e confira seu desempenho individual.'}
            {isManager && ' Gerencie usuários, aprove vouchers e acompanhe o time todo.'}
            {currentUser?.role === 'evaluator' && ' Faça as finalizações dos laudos e aprove cancelamentos.'}
          </p>
        </div>
        <div className="topbar-role">
          <span className="section-tag">{getRoleBadgeLabel(currentUser.role)}</span>
          <small>
            {isPrivilegedUser
              ? 'Acesso completo aos indicadores, à agenda e ao histórico.'
              : 'Acesso focado na sua agenda e no seu desempenho.'}
          </small>
          <div className="topbar-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowChangePassword(true)}
            >
              Alterar senha
            </button>
            <button type="button" className="ghost-button logout-button" onClick={handleSignOut}>
              Sair
            </button>
          </div>
        </div>
      </header>

      <nav className="mobile-nav" aria-label="Navegação principal">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            aria-current={({ isActive }) => (isActive ? 'page' : undefined)}
          >
            <span className="nav-link-icon" aria-hidden>{link.icon}</span>
            {link.label}
          </NavLink>
        ))}
        <button type="button" className="nav-link nav-link-button" onClick={handleSignOut}>
          <span className="nav-link-icon" aria-hidden>🚪</span>
          Sair
        </button>
      </nav>

      <main className="page-content">
        <Outlet />
      </main>

      <footer className="app-footer">
        <p>&copy; 2026 AutoAgenda V2. Todos os direitos reservados.</p>
        <span className="made-by-badge" aria-label="Feito por">
          <span>Feito por:</span>
          <a href="https://ndevstudio.netlify.app/" target="_blank" rel="noopener noreferrer" aria-label="NDev Studio">
            NDev Studio
          </a>
        </span>
      </footer>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
