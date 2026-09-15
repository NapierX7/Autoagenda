import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  approvePendingProfile,
  createSellerUser,
  deleteUser,
  getCompanyProfiles,
  rejectPendingProfile,
  resetUserPassword,
  toggleActiveProfile,
} from '../services/appointmentsService';

function getRoleLabel(role) {
  if (role === 'admin') return 'Gerente';
  if (role === 'evaluator') return 'Avaliador';
  if (role === 'seller') return 'Vendedor';
  return role;
}

function getApprovalLabel(approvalStatus) {
  if (approvalStatus === 'pending') return 'Aguardando aprovação';
  if (approvalStatus === 'rejected') return 'Recusado';
  return 'Aprovado';
}

function getAccessStatusLabel(profile) {
  if (!profile.isActive) return 'Desativado';
  return getApprovalLabel(profile.approvalStatus);
}

function generateTemporaryPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@';
  let pass = '';
  for (let i = 0; i < 8; i++) {
    pass += chars[Math.floor(Math.random() * chars.length)];
  }
  return pass + 'Aa1!';
}

export default function UsersPage() {
  const { currentUser, isManager } = useAuth();
  const { showToast } = useToast();
  const [profiles, setProfiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState('mock');
  const [showNewUser, setShowNewUser] = useState(false);
  const [showResetFor, setShowResetFor] = useState(null);
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [formValues, setFormValues] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'seller',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(null);

  async function loadProfiles() {
    try {
      setIsLoading(true);
      setError('');
      const response = await getCompanyProfiles();
      setProfiles(response.items || []);
      setSource(response.source);
    } catch (e) {
      setError(e.message ?? 'Não foi possível carregar os usuários.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadProfiles();
  }, []);

  const pendingProfiles = useMemo(
    () => profiles.filter((p) => p.approvalStatus === 'pending'),
    [profiles],
  );
  const activeProfiles = useMemo(
    () => profiles.filter((p) => p.approvalStatus !== 'pending'),
    [profiles],
  );

  if (!isManager) {
    return (
      <div className="page-stack">
        <section className="info-panel compact error-panel">
          <span className="section-tag">Acesso negado</span>
          <p>Apenas gerentes podem acessar a área de gerenciamento de usuários.</p>
        </section>
      </div>
    );
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    setError('');

    if (!formValues.fullName.trim()) {
      setError('Informe o nome completo do vendedor.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formValues.email)) {
      setError('Informe um e-mail válido para o login.');
      return;
    }
    if (!formValues.password || formValues.password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createSellerUser({
        ...formValues,
        companyId: currentUser?.companyId,
      });

      if (result.success) {
        showToast({
          title: 'Conta criada',
          message: `Conta de ${formValues.fullName} criada com sucesso. Compartilhe o e-mail e a senha para o primeiro acesso.`,
          tone: 'success',
        });
        setFormValues({ fullName: '', email: '', password: '', role: 'seller' });
        setShowNewUser(false);
        await loadProfiles();
      } else {
        throw new Error(result.message ?? 'Falha ao criar usuário.');
      }
    } catch (e) {
      setError(e.message ?? 'Falha ao criar a conta do vendedor.');
      showToast({
        title: 'Falha ao criar',
        message: e.message ?? 'Não foi possível criar o usuário.',
        tone: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword(userId) {
    setError('');
    if (!newPasswordValue || newPasswordValue.length < 6) {
      setError('A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await resetUserPassword(userId, newPasswordValue);
      if (result.success) {
        showToast({
          title: 'Senha redefinida',
          message: result.message ?? 'Senha redefinida com sucesso.',
          tone: 'success',
        });
        setShowResetFor(null);
        setNewPasswordValue('');
      } else {
        throw new Error(result.message ?? 'Falha ao redefinir.');
      }
    } catch (e) {
      setError(e.message ?? 'Falha ao redefinir a senha.');
      showToast({
        title: 'Falha ao redefinir',
        message: e.message ?? 'Não foi possível redefinir a senha.',
        tone: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleApprove(userId) {
    setIsActionLoading(userId);
    try {
      const result = await approvePendingProfile(userId);
      if (result.success) {
        showToast({ title: 'Aprovado!', message: result.message, tone: 'success' });
        await loadProfiles();
      } else {
        throw new Error(result.message);
      }
    } catch (e) {
      showToast({ title: 'Falha', message: e.message, tone: 'error' });
    } finally {
      setIsActionLoading(null);
    }
  }

  async function handleReject(userId) {
    if (!window.confirm('Tem certeza que deseja recusar este cadastro? O usuário não terá acesso.')) {
      return;
    }
    setIsActionLoading(userId);
    try {
      const result = await rejectPendingProfile(userId);
      if (result.success) {
        showToast({ title: 'Recusado', message: result.message, tone: 'warning' });
        await loadProfiles();
      } else {
        throw new Error(result.message);
      }
    } catch (e) {
      showToast({ title: 'Falha', message: e.message, tone: 'error' });
    } finally {
      setIsActionLoading(null);
    }
  }

  async function handleToggleActive(profile) {
    const isCurrentlyActive = profile.isActive;
    const confirmMessage = isCurrentlyActive
      ? `Tem certeza que deseja DESATIVAR o login de ${profile.fullName}? Ele não conseguirá mais entrar até ser reativado. O histórico de laudos e agendamentos dele permanece intacto.`
      : `Tem certeza que deseja REATIVAR o login de ${profile.fullName}? Ele voltará a conseguir logar normalmente.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setIsActionLoading(profile.id);
    try {
      const result = await toggleActiveProfile(profile.id, !isCurrentlyActive);
      if (result.success) {
        showToast({
          title: isCurrentlyActive ? 'Login desativado' : 'Login reativado',
          message: result.message,
          tone: isCurrentlyActive ? 'warning' : 'success',
        });
        await loadProfiles();
      } else {
        throw new Error(result.message);
      }
    } catch (e) {
      showToast({ title: 'Falha', message: e.message, tone: 'error' });
    } finally {
      setIsActionLoading(null);
    }
  }

  async function handleDelete(profile) {
    const confirmMessage =
      `Tem CERTEZA ABSOLUTA que deseja EXCLUIR PERMANENTEMENTE o usuário ${profile.fullName}?\n\n` +
      `- A conta de login dele (auth.users) será apagada e ele NUNCA MAIS conseguirá logar com esse e-mail.\n` +
      `- O registro em profiles também é apagado.\n` +
      `- Agendamentos do histórico não são apagados (para manter dados de laudos).\n\n` +
      `Se só quer proíbir o acesso temporariamente, use "Desativar login" ao invés de excluir.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setIsActionLoading(profile.id);
    try {
      const result = await deleteUser(profile.id);
      if (result.success) {
        showToast({
          title: 'Usuário excluído',
          message: result.message,
          tone: 'success',
        });
        await loadProfiles();
      } else {
        throw new Error(result.message);
      }
    } catch (e) {
      const raw = String(e?.message ?? 'Erro desconhecido.').toLowerCase();
      let friendly = e?.message ?? 'Falha ao excluir o usuário.';
      if (raw.includes('ação inválida') || raw.includes('invalid action') || raw.includes('action inválida')) {
        friendly =
          '⚠️ A versão publicada da Edge Function não possui a ação "delete-user". ' +
          'É preciso atualizar a edge function "user-admin-actions" no painel do Supabase ' +
          '(Editor Inline → colar o conteúdo do arquivo user-admin-actions_INLINE_COMPLETO_v4.ts e salvar). ' +
          'Depois de publicar a v4, esta ação funcionará.';
      } else if (raw.includes('não tem permissão') || raw.includes('403') || raw.includes('permissao')) {
        friendly =
          '⚠️ Permissão temporariamente indisponível. Faça LOGOUT e entre NOVAMENTE para renovar a sessão ' +
          'com permissões atualizadas, depois tente excluir de novo.';
      } else if (raw.includes('perfil não encontrado') || raw.includes('profile not found')) {
        friendly =
          '⚠️ Este usuário não possui profile vinculado. É possível que ele já tenha sido ' +
          'excluído parcialmente. Atualize a página (F5) para confirmar se ele desapareceu da lista.';
      } else if (raw.includes('mesma empresa') || raw.includes('same company') || raw.includes('voce nao tem permissao sobre esse usuario')) {
        friendly =
          '⚠️ Regra multi-tenant: você só pode excluir usuários DA SUA EMPRESA. ' +
          'Este perfil pertence a outra company_id.';
      } else if (raw.includes('própria conta') || raw.includes('your own') || raw.includes('mesmo usuário')) {
        friendly = '⚠️ Você não pode excluir a SUA PRÓPRIA conta.';
      } else if (raw.includes('autenticação necessária') || raw.includes('401')) {
        friendly = '⚠️ Sessão expirou. Faça LOGOUT e entre novamente.';
      }
      showToast({ title: 'Falha ao excluir usuário', message: friendly, tone: 'error' });
    } finally {
      setIsActionLoading(null);
    }
  }

  function getRoleIcon(role) {
    if (role === 'admin') return '👑';
    if (role === 'evaluator') return '🔍';
    return '🛒';
  }

  function getApprovalTone(status) {
    if (status === 'pending') return 'warning-tag';
    if (status === 'rejected') return 'danger-tag';
    return 'success-tag';
  }

  return (
    <div className="page-stack">
      <section className="info-panel">
        <span className="section-tag">👥 Gerenciar usuários</span>
        <h2>Contas, acessos e permissões.</h2>
        <p>Aprove solicitações, crie vendedores e gerencie logins da sua empresa.</p>
      </section>

      {source === 'mock' && (
        <section className="info-panel compact">
          <span className="section-tag warning-tag">🧪 Modo demo</span>
          <p>Dados simulados ativos. Conecte a service role para ações reais no Supabase.</p>
        </section>
      )}

      <section className="info-panel compact">
        <div className="section-heading">
          <div>
            <span className="section-tag">
              {pendingProfiles.length > 0 ? `⚠️ ${pendingProfiles.length} pendente(s)` : '✅ Sem pendências'}
            </span>
            <h3>
              <strong>{activeProfiles.length}</strong> usuário(s) cadastrado(s).
            </h3>
          </div>
        </div>
        <div className="inline-actions">
          <p />
          <button
            type="button"
            className="primary-button"
            onClick={() => setShowNewUser(true)}
          >
            ➕ Novo usuário
          </button>
        </div>
      </section>

      {error && (
        <section className="info-panel compact error-panel">
          <span className="section-tag">⚠️ Erro</span>
          <p>{error}</p>
        </section>
      )}

      {isLoading ? (
        <section className="info-panel compact">
          <div className="section-heading">
            <div>
              <span className="section-tag">⏳ Carregando usuários</span>
              <h3>Buscando perfis da empresa…</h3>
            </div>
          </div>
          <div className="users-list" style={{ marginTop: '16px' }}>
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="history-card user-card skeleton-card">
                <div>
                  <div className="skeleton skeleton-line w-20" />
                  <div className="skeleton skeleton-line w-50" />
                  <div className="skeleton skeleton-line w-40" />
                </div>
                <div>
                  <div className="skeleton skeleton-line w-60" />
                  <div className="skeleton skeleton-line w-80" />
                  <div className="skeleton skeleton-line w-70" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          {pendingProfiles.length > 0 && (
            <section className="info-panel compact">
              <div className="section-heading">
                <div>
                  <span className="section-tag warning-tag">⏳ Pendentes de aprovação</span>
                  <h3>Solicitações novas de acesso</h3>
                </div>
              </div>
              <p>Aprove ou recuse. Usuários aprovados já podem logar imediatamente.</p>
              <div className="users-list">
                {pendingProfiles.map((p) => (
                  <article key={p.id} className="history-card user-card">
                    <div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="eyebrow">{getRoleIcon(p.role)} {getRoleLabel(p.role)}</span>
                        <span className={`section-tag ${getApprovalTone(p.approvalStatus)}`}>
                          {getApprovalLabel(p.approvalStatus)}
                        </span>
                      </div>
                      <h3>{p.fullName}</h3>
                      {p.email && <p>✉️ {p.email}</p>}
                    </div>
                    <div>
                      <dl>
                        <div>
                          <dt>Perfil</dt>
                          <dd>{getRoleLabel(p.role)}</dd>
                        </div>
                        {p.requestedAt && (
                          <div>
                            <dt>Solicitado em</dt>
                            <dd>{new Date(p.requestedAt).toLocaleString('pt-BR')}</dd>
                          </div>
                        )}
                      </dl>
                      <div className="card-actions-end">
                        <button
                          type="button"
                          className="ghost-button danger"
                          onClick={() => handleReject(p.id)}
                          disabled={isActionLoading === p.id}
                        >
                          {isActionLoading === p.id ? 'Processando…' : '✕ Recusar'}
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => handleApprove(p.id)}
                          disabled={isActionLoading === p.id}
                        >
                          {isActionLoading === p.id ? 'Aprovando…' : '✅ Aprovar'}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeProfiles.length === 0 ? (
            <section className="info-panel compact empty-state">
              <div className="empty-state-visual" aria-hidden>👥</div>
              <span className="section-tag">Sem usuários</span>
              <h3>Nenhum perfil encontrado para a sua empresa.</h3>
              <p>Clique em "Novo usuário" para criar o primeiro acesso.</p>
            </section>
          ) : (
            <div className="users-list">
              {activeProfiles.map((p) => (
                <article
                  key={p.id}
                  className={`history-card user-card ${p.isActive ? '' : 'inactive'}`}
                >
                  <div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="eyebrow">{getRoleIcon(p.role)} {getRoleLabel(p.role)}</span>
                      <span className={`section-tag ${p.isActive ? 'success-tag' : 'danger-tag'}`}>
                        {p.isActive ? '✅ Ativo' : '🚫 Desativado'}
                      </span>
                      {p.approvalStatus === 'rejected' && (
                        <span className="section-tag danger-tag">❌ Recusado</span>
                      )}
                    </div>
                    <h3>{p.fullName}</h3>
                    {p.email && <p>✉️ {p.email}</p>}
                    {!p.isActive && (
                      <small className="helper-text-inline">
                        ⚠️ Conta desativada — login bloqueado até reativação.
                      </small>
                    )}
                  </div>
                  <div>
                    <dl>
                      <div>
                        <dt>Perfil</dt>
                        <dd>{getRoleLabel(p.role)}</dd>
                      </div>
                      <div>
                        <dt>Status de acesso</dt>
                        <dd>
                          <strong
                            className={
                              p.isActive
                                ? p.approvalStatus === 'rejected'
                                  ? 'text-danger'
                                  : 'text-success'
                                : 'text-danger'
                            }
                          >
                            {getAccessStatusLabel(p)}
                          </strong>
                        </dd>
                      </div>
                      {p.createdAt && (
                        <div>
                          <dt>Criado em</dt>
                          <dd>{new Date(p.createdAt).toLocaleDateString('pt-BR')}</dd>
                        </div>
                      )}
                    </dl>
                    <div className="card-actions-end">
                      {p.role === 'seller' && p.id !== currentUser?.id && (
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => {
                            setShowResetFor(p.id);
                            setNewPasswordValue(generateTemporaryPassword());
                            setError('');
                          }}
                          disabled={isActionLoading === p.id}
                        >
                          🔑 Redefinir senha
                        </button>
                      )}
                      {p.role === 'seller' && p.id !== currentUser?.id && (
                        <button
                          type="button"
                          className={p.isActive ? 'ghost-button danger' : 'ghost-button success'}
                          onClick={() => handleToggleActive(p)}
                          disabled={isActionLoading === p.id}
                        >
                          {isActionLoading === p.id
                            ? 'Processando…'
                            : p.isActive
                              ? '🚫 Desativar'
                              : '✅ Reativar'}
                        </button>
                      )}
                      {p.id !== currentUser?.id && (
                        <button
                          type="button"
                          className="ghost-button danger"
                          onClick={() => handleDelete(p)}
                          disabled={isActionLoading === p.id}
                          title="Excluir permanentemente (não desativa — apaga do banco)"
                        >
                          {isActionLoading === p.id ? 'Excluindo…' : '🗑️ Excluir'}
                        </button>
                      )}
                    </div>
                    {showResetFor === p.id && (
                      <div className="reset-password-inline">
                        <label className="modal-grid-full">
                          Nova senha temporária
                          <input
                            type="text"
                            value={newPasswordValue}
                            onChange={(e) => setNewPasswordValue(e.target.value)}
                          />
                          <small>
                            Guarde esta senha para compartilhar com o vendedor. Ele poderá trocá-la depois.
                          </small>
                        </label>
                        <div className="card-actions-end">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              setShowResetFor(null);
                              setNewPasswordValue('');
                            }}
                            disabled={isSubmitting}
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => handleResetPassword(p.id)}
                            disabled={isSubmitting}
                          >
                            {isSubmitting ? 'Redefinindo…' : 'Confirmar senha'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {showNewUser && (
        <div className="modal-backdrop" role="presentation" onClick={() => !isSubmitting && setShowNewUser(false)}>
          <section
            className="modal-panel small-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-header">
              <div>
                <span className="section-tag">Novo vendedor</span>
                <h2>Criar conta de acesso</h2>
                <p>O vendedor receberá login com e-mail e senha definidos abaixo.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => !isSubmitting && setShowNewUser(false)}
              >
                x
              </button>
            </header>

            {error && (
              <div className="auth-message error">
                <strong>Falha.</strong>
                <span>{error}</span>
              </div>
            )}

            <form className="modal-form" onSubmit={handleCreateUser}>
              <label>
                Nome completo
                <input
                  value={formValues.fullName}
                  onChange={(e) => setFormValues((v) => ({ ...v, fullName: e.target.value }))}
                  placeholder="João da Silva"
                  required
                  disabled={isSubmitting}
                />
              </label>

              <label>
                E-mail (login)
                <input
                  type="email"
                  value={formValues.email}
                  onChange={(e) => setFormValues((v) => ({ ...v, email: e.target.value }))}
                  placeholder="joao@suaempresa.com"
                  required
                  disabled={isSubmitting}
                />
              </label>

              <label>
                Perfil
                <select
                  value={formValues.role}
                  onChange={(e) => setFormValues((v) => ({ ...v, role: e.target.value }))}
                  disabled={isSubmitting}
                >
                  <option value="seller">Vendedor</option>
                  <option value="evaluator">Avaliador</option>
                </select>
              </label>

              <label>
                Senha inicial
                <div className="file-upload-row">
                  <input
                    type="text"
                    value={formValues.password}
                    onChange={(e) => setFormValues((v) => ({ ...v, password: e.target.value }))}
                    placeholder="Mínimo 6 caracteres"
                    required
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setFormValues((v) => ({ ...v, password: generateTemporaryPassword() }))}
                    disabled={isSubmitting}
                  >
                    Gerar forte
                  </button>
                </div>
              </label>

              <footer className="modal-actions">
                <div />
                <div className="modal-primary-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setShowNewUser(false)}
                    disabled={isSubmitting}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="primary-button" disabled={isSubmitting}>
                    {isSubmitting ? 'Criando...' : 'Criar conta'}
                  </button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
