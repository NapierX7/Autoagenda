import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getPublicCompaniesList } from '../services/appointmentsService';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { authError, getDefaultRoute, isDemoMode, isLoading, signIn, registerSeller } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(false);
  const [formValues, setFormValues] = useState({
    email: '',
    password: '',
  });
  const [submitError, setSubmitError] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [registerValues, setRegisterValues] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    companyId: '',
  });
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState('');
  const [isSubmittingRegister, setIsSubmittingRegister] = useState(false);

  useEffect(() => {
    async function loadCompanies() {
      setIsLoadingCompanies(true);
      try {
        const list = await getPublicCompaniesList();
        setCompanies(list ?? []);
        if ((list ?? []).length === 1) {
          setRegisterValues((current) => ({ ...current, companyId: list[0].id }));
        }
      } finally {
        setIsLoadingCompanies(false);
      }
    }
    loadCompanies();
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;
    setFormValues((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleRegisterChange(event) {
    const { name, value } = event.target;
    setRegisterValues((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError('');

    const result = await signIn(formValues);

    if (!result.success) {
      setSubmitError(result.error ?? 'Não foi possível entrar.');
      return;
    }

    navigate(location.state?.from?.pathname ?? getDefaultRoute(), { replace: true });
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault();
    setRegisterError('');
    setRegisterSuccess('');

    if (!registerValues.fullName || registerValues.fullName.trim().length < 3) {
      setRegisterError('Informe seu nome completo.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerValues.email)) {
      setRegisterError('Informe um e-mail válido.');
      return;
    }
    if (!registerValues.password || registerValues.password.length < 6) {
      setRegisterError('A senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (registerValues.password !== registerValues.confirmPassword) {
      setRegisterError('A confirmação da senha não bate com a senha digitada.');
      return;
    }
    if (!registerValues.companyId) {
      setRegisterError('Selecione a loja onde você trabalha.');
      return;
    }

    setIsSubmittingRegister(true);
    const result = await registerSeller({
      fullName: registerValues.fullName,
      email: registerValues.email,
      password: registerValues.password,
      companyId: registerValues.companyId,
    });

    if (!result.success) {
      setIsSubmittingRegister(false);
      setRegisterError(result.error ?? 'Não foi possível concluir o cadastro.');
      return;
    }

    setRegisterSuccess(result.message ?? 'Cadastro enviado com sucesso.');
    setIsSubmittingRegister(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        {!showRegister ? (
          <>
            <h1>Acesse o ambiente da sua empresa.</h1>
            <p>
              Entre com sua conta para visualizar a agenda, acompanhar os horários e operar o sistema com dados reais.
            </p>

            {isDemoMode && (
              <div className="auth-message info">
                <strong>Modo demonstração ativo.</strong>
                <span>
                  Enquanto `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` não forem configuradas,
                  o acesso continuará usando o ambiente de demonstração para não interromper os testes.
                </span>
              </div>
            )}

            {(submitError || authError) && (
              <div className="auth-message error">
                <strong>Falha ao entrar.</strong>
                <span>{submitError || authError}</span>
              </div>
            )}

            <form className="auth-form" onSubmit={handleSubmit}>
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  placeholder="empresa@autoagenda.com"
                  value={formValues.email}
                  onChange={handleChange}
                  required
                />
              </label>
              <label>
                Senha
                <input
                  name="password"
                  type="password"
                  placeholder="********"
                  value={formValues.password}
                  onChange={handleChange}
                  required
                />
              </label>
              <button type="submit" disabled={isLoading}>
                {isLoading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>

            <div className="auth-helper-list">
              <span>As credenciais de acesso são gerenciadas pelo Supabase Auth.</span>
              <span>Após o login, o perfil da empresa é carregado automaticamente pela tabela `profiles`.</span>
            </div>

            <button
              type="button"
              className="ghost-link"
              onClick={() => {
                setShowRegister(true);
                setRegisterError('');
                setRegisterSuccess('');
              }}
            >
              Sou novo, quero criar minha conta de vendedor
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="link-back"
              onClick={() => {
                setShowRegister(false);
                setSubmitError('');
              }}
            >
              ← Voltar para o login
            </button>
            <h1>Crie sua conta de vendedor.</h1>
            <p>
              Preencha seus dados abaixo e selecione a loja onde você trabalha.
              Após o envio, o gerente da SUA LOJA irá analisar e aprovar seu acesso.
            </p>

            {registerSuccess && (
              <div className="auth-message success">
                <strong>Cadastro enviado!</strong>
                <span>{registerSuccess}</span>
              </div>
            )}

            {registerError && (
              <div className="auth-message error">
                <strong>Falha no cadastro.</strong>
                <span>{registerError}</span>
              </div>
            )}

            <form className="auth-form" onSubmit={handleRegisterSubmit}>
              <div className="company-picker-field">
                <label className="company-picker-title">
                  Selecione a loja onde você trabalha
                  <small className="helper-text-inline">
                    👉 É muito importante escolher a loja certa. O gerente SOMENTE da loja selecionada vai poder aprovar seu acesso.
                  </small>
                </label>

                {isLoadingCompanies ? (
                  <div className="company-picker-empty">
                    <strong>Carregando lojas...</strong>
                    <small>Estamos buscando as lojas cadastradas.</small>
                  </div>
                ) : companies.length === 0 ? (
                  <div className="company-picker-empty">
                    <strong>Nenhuma loja encontrada.</strong>
                    <small>Entre em contato com a AutoAgenda para cadastrar sua loja.</small>
                  </div>
                ) : (
                  <div className="company-picker-list" role="radiogroup" aria-label="Lista de lojas disponíveis">
                    {companies.map((company) => {
                      const isSelected = registerValues.companyId === company.id;
                      return (
                        <button
                          key={company.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          className={`company-picker-card ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => {
                            if (isSubmittingRegister || registerSuccess) return;
                            handleRegisterChange({
                              target: { name: 'companyId', value: company.id },
                            });
                          }}
                          disabled={isSubmittingRegister || Boolean(registerSuccess)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              if (isSubmittingRegister || registerSuccess) return;
                              handleRegisterChange({
                                target: { name: 'companyId', value: company.id },
                              });
                            }
                          }}
                        >
                          <div className="company-picker-radio" aria-hidden>
                            <span className={`company-picker-radio-dot ${isSelected ? 'is-filled' : ''}`} />
                          </div>
                          <div className="company-picker-info">
                            <strong>{company.name}</strong>
                            {company.cnpj && (
                              <small>CNPJ: {company.cnpj}</small>
                            )}
                            {company.address && !company.cnpj && (
                              <small>{company.address}</small>
                            )}
                            {isSelected && (
                              <span className="company-picker-selected-tag">Loja selecionada ✔</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {!registerValues.companyId && !isLoadingCompanies && companies.length > 0 && (
                  <small className="company-picker-hint">
                    👆 Clique em uma das lojas acima para selecionar.
                  </small>
                )}
              </div>

              {/* Select fallback oculto (mantém compatibilidade do HTML form required mas nao mostra) */}
              <select
                name="companyId"
                tabIndex={-1}
                aria-hidden="true"
                value={registerValues.companyId}
                onChange={handleRegisterChange}
                required
                disabled={isLoadingCompanies || isSubmittingRegister || Boolean(registerSuccess)}
                className="company-picker-select-fallback"
              >
                <option value="">{isLoadingCompanies ? 'Carregando lojas...' : '-- Selecione a loja --'}</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <label>
                Nome completo
                <input
                  name="fullName"
                  placeholder="João da Silva"
                  value={registerValues.fullName}
                  onChange={handleRegisterChange}
                  required
                  disabled={isSubmittingRegister || Boolean(registerSuccess)}
                />
              </label>
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  placeholder="joao@suaempresa.com"
                  value={registerValues.email}
                  onChange={handleRegisterChange}
                  required
                  disabled={isSubmittingRegister || Boolean(registerSuccess)}
                />
              </label>
              <label>
                Senha (mínimo 6 caracteres)
                <input
                  name="password"
                  type="password"
                  placeholder="********"
                  value={registerValues.password}
                  onChange={handleRegisterChange}
                  required
                  disabled={isSubmittingRegister || Boolean(registerSuccess)}
                />
              </label>
              <label>
                Confirmar senha
                <input
                  name="confirmPassword"
                  type="password"
                  placeholder="********"
                  value={registerValues.confirmPassword}
                  onChange={handleRegisterChange}
                  required
                  disabled={isSubmittingRegister || Boolean(registerSuccess)}
                />
              </label>
              <button
                type="submit"
                disabled={isSubmittingRegister || Boolean(registerSuccess)}
              >
                {isSubmittingRegister
                  ? 'Enviando...'
                  : registerSuccess
                    ? 'Aguardando aprovação'
                    : 'Solicitar acesso à minha loja'}
              </button>
            </form>

            <div className="auth-helper-list">
              <span>
                <strong>Importante:</strong> esta é uma conta de vendedor. O cadastro fica aguardando aprovação do
                gerente da loja selecionada antes de liberar o acesso.
              </span>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
