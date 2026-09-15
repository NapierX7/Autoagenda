import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { hasSupabaseCredentials } from '../lib/supabase';
import {
  getProfile,
  getSession,
  onAuthStateChange,
  signInWithPassword,
  signOut as authSignOut,
} from '../services/authService';
import {
  changeCurrentUserPassword,
  selfRegisterSeller,
} from '../services/appointmentsService';

const AuthContext = createContext(null);

const demoUser = {
  id: 'company-owner-demo',
  email: 'demo@autoagenda.com',
  fullName: 'Administrador Demo',
  companyId: 'company-demo',
  companyName: 'Auto Prime Veículos',
  companySlug: 'auto-prime-veiculos',
  role: 'admin',
  approvalStatus: 'approved',
  isActive: true,
};

const privilegedRoles = ['admin', 'evaluator'];
const managerRole = ['admin'];

function getDefaultRouteByRole(role) {
  return privilegedRoles.includes(role) ? '/dashboard' : '/desempenho';
}

function normalizeProfile(profile, authUser) {
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    email: authUser?.email ?? null,
    fullName: profile.full_name,
    companyId: profile.company?.id ?? null,
    companyName: profile.company?.name ?? 'Empresa sem nome',
    companySlug: profile.company?.slug ?? '',
    role: profile.role,
    approvalStatus: profile.approval_status ?? 'approved',
    isActive: profile.is_active !== false,
  };
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const hydrateFromSession = useCallback(async (session) => {
    if (!hasSupabaseCredentials) {
      setCurrentUser(demoUser);
      setIsLoading(false);
      return;
    }

    if (!session?.user) {
      setCurrentUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const profile = await getProfile(session.user.id);
      const normalized = normalizeProfile(profile, session.user);

      if (normalized && normalized.approvalStatus === 'pending') {
        setCurrentUser(null);
        await authSignOut();
        setAuthError('Seu cadastro está aguardando aprovação do gerente. Tente novamente em breve.');
        setIsLoading(false);
        return;
      }

      if (normalized && normalized.approvalStatus === 'rejected') {
        setCurrentUser(null);
        await authSignOut();
        setAuthError('Seu cadastro foi recusado. Entre em contato com a gerência.');
        setIsLoading(false);
        return;
      }

      if (normalized && normalized.isActive === false) {
        setCurrentUser(null);
        await authSignOut();
        setAuthError('Sua conta está desativada. Entre em contato com a gerência para reativar o acesso.');
        setIsLoading(false);
        return;
      }

      setCurrentUser(normalized);
      setAuthError('');
    } catch (error) {
      setCurrentUser(null);
      setAuthError(error.message ?? 'Não foi possível carregar o perfil da empresa.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function bootstrapAuth() {
      const { data } = await getSession();

      if (!isMounted) {
        return;
      }

      await hydrateFromSession(data.session);
    }

    bootstrapAuth();

    const { data } = onAuthStateChange((_event, session) => {
      hydrateFromSession(session);
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, [hydrateFromSession]);

  const signIn = useCallback(async ({ email, password }) => {
    if (!hasSupabaseCredentials) {
      setCurrentUser(demoUser);
      setAuthError('');
      return { success: true, mode: 'demo' };
    }

    setIsLoading(true);
    setAuthError('');

    const { error } = await signInWithPassword({ email, password });

    if (error) {
      setIsLoading(false);
      setAuthError(error.message);
      return { success: false, error: error.message };
    }

    return { success: true, mode: 'supabase' };
  }, []);

  const signOut = useCallback(async () => {
    if (!hasSupabaseCredentials) {
      setCurrentUser(null);
      return;
    }

    await authSignOut();
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    try {
      const result = await changeCurrentUserPassword(currentPassword, newPassword);
      return result;
    } catch (error) {
      return { success: false, error: error.message ?? 'Não foi possível alterar a senha.' };
    }
  }, []);

  const registerSeller = useCallback(async ({ fullName, email, password, companyId }) => {
    try {
      const result = await selfRegisterSeller({ fullName, email, password, companyId });
      return result;
    } catch (error) {
      return { success: false, error: error.message ?? 'Não foi possível concluir o cadastro.' };
    }
  }, []);

  const value = useMemo(() => ({
    currentUser,
    authError,
    isLoading,
    isAuthenticated: Boolean(currentUser),
    isDemoMode: !hasSupabaseCredentials,
    isPrivilegedUser: privilegedRoles.includes(currentUser?.role),
    isManager: managerRole.includes(currentUser?.role),
    isEvaluator: currentUser?.role === 'evaluator',
    isSeller: currentUser?.role === 'seller',
    getDefaultRoute: () => getDefaultRouteByRole(currentUser?.role),
    signIn,
    signOut,
    changePassword,
    registerSeller,
  }), [authError, currentUser, isLoading, signIn, signOut, changePassword, registerSeller]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
