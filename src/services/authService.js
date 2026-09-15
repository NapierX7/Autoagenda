import { supabase } from '../lib/supabase';

export function getSession() {
  if (!supabase) {
    return Promise.resolve({ data: { session: null }, error: null });
  }

  return supabase.auth.getSession();
}

export function onAuthStateChange(callback) {
  if (!supabase) {
    return {
      data: {
        subscription: {
          unsubscribe() {},
        },
      },
    };
  }

  return supabase.auth.onAuthStateChange(callback);
}

export async function signInWithPassword({ email, password }) {
  if (!supabase) {
    return { data: null, error: null };
  }

  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  if (!supabase) {
    return { error: null };
  }

  return supabase.auth.signOut();
}

export async function getProfile(userId) {
  if (!supabase || !userId) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select(`
      id,
      full_name,
      role,
      approval_status,
      is_active,
      company:companies (
        id,
        name,
        slug
      )
    `)
    .eq('id', userId)
    .single();

  if (error) {
    throw error;
  }

  return data;
}
