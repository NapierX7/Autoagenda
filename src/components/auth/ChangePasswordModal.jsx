import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

export default function ChangePasswordModal({ onClose }) {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!newPassword || newPassword.length < 6) {
      setError('A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('A confirmação da nova senha não bate com a senha digitada.');
      return;
    }

    setIsLoading(true);
    const result = await changePassword(currentPassword, newPassword);

    if (result.success) {
      setSuccess(result.message ?? 'Senha alterada com sucesso.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => onClose && onClose(), 1400);
    } else {
      setError(result.error ?? 'Não foi possível alterar a senha.');
    }

    setIsLoading(false);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-panel small-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <span className="section-tag">Segurança</span>
            <h2 id="change-password-title">Alterar minha senha</h2>
            <p>Defina uma nova senha forte para manter sua conta segura.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            x
          </button>
        </header>

        {success && (
          <div className="auth-message info">
            <strong>Senha alterada!</strong>
            <span>{success}</span>
          </div>
        )}
        {error && (
          <div className="auth-message error">
            <strong>Falha ao alterar.</strong>
            <span>{error}</span>
          </div>
        )}

        <form className="modal-form" onSubmit={handleSubmit}>
          <label>
            Senha atual
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Sua senha atual"
              disabled={isLoading}
            />
          </label>

          <label>
            Nova senha
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              disabled={isLoading}
            />
          </label>

          <label>
            Confirmar nova senha
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Digite novamente"
              disabled={isLoading}
            />
          </label>

          <footer className="modal-actions">
            <div />
            <div className="modal-primary-actions">
              <button type="button" className="ghost-button" onClick={onClose} disabled={isLoading}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isLoading}>
                {isLoading ? 'Alterando...' : 'Salvar senha'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
