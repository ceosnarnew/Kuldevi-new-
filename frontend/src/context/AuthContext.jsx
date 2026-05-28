import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  const checkAdmin = async (userId) => {
    if (!userId) { setIsAdmin(false); return }
    const { data } = await supabase.from('admins').select('user_id').eq('user_id', userId).maybeSingle()
    setIsAdmin(!!data)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      checkAdmin(session?.user?.id)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      checkAdmin(session?.user?.id)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Admin login
  const login = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    const { data: adminRow, error: adminErr } = await supabase
      .from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle()
    if (adminErr) throw new Error(`Admin check failed: ${adminErr.message}`)
    if (!adminRow) {
      await supabase.auth.signOut()
      throw new Error('Not an admin account. Make sure you ran the INSERT INTO admins SQL.')
    }
    setIsAdmin(true)
    return data
  }, [])

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    setIsAdmin(false)
  }, [])

  // Customer auth
  const customerLogin = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }, [])

  const customerRegister = useCallback(async (name, email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } }
    })
    if (error) throw error
    return data
  }, [])

  const customerLogout = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const isCustomer = !!user && !isAdmin

  return (
    <AuthContext.Provider value={{
      user,
      isAdmin,
      isCustomer,
      loading,
      // Admin aliases for backward compat
      token: isAdmin ? 'supabase-session' : null,
      username: user?.email,
      login,
      logout,
      // Customer aliases
      customerToken: isCustomer ? 'supabase-session' : null,
      customerName: user?.user_metadata?.full_name || user?.email,
      customerLogin,
      customerRegister,
      customerLogout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
