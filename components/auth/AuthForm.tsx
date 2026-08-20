'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, Lock, User, Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Label } from '@/components/ui/label'

interface AuthFormProps {
  mode: 'login' | 'signup'
  redirectTo?: string
}

const ERROR_MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar — verifique sua caixa de entrada.',
  'User already registered': 'Já existe uma conta com este e-mail. Tente entrar.',
}

function translateError(message: string) {
  return ERROR_MESSAGES[message] ?? message
}

export function AuthForm({ mode, redirectTo = '/dashboard' }: AuthFormProps) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signupSuccess, setSignupSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    try {
      if (mode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) {
          setError(translateError(signInError.message))
          return
        }
        router.push(redirectTo)
        router.refresh()
      } else {
        if (password.length < 8) {
          setError('A senha precisa ter pelo menos 8 caracteres.')
          return
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: `${location.origin}/auth/callback`,
          },
        })

        if (signUpError) {
          setError(translateError(signUpError.message))
          return
        }

        if (data.session) {
          // Confirmação de e-mail desativada no projeto — já entra direto
          router.push(redirectTo)
          router.refresh()
        } else {
          setSignupSuccess(true)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  if (signupSuccess) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
        Conta criada! Enviamos um link de confirmação para <strong>{email}</strong>. Confirme seu
        e-mail para poder entrar.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode === 'signup' && (
        <div>
          <Label htmlFor="full_name">Nome completo</Label>
          <div className="relative mt-1">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="full_name"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Dr. Ana Souza"
              className="w-full rounded-lg border border-gray-200 py-2.5 pl-10 pr-3 text-sm outline-none transition-shadow focus:border-[var(--cyan)] focus:ring-2 focus:ring-[var(--cyan-20)]"
            />
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="email">E-mail</Label>
        <div className="relative mt-1">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@clinica.com"
            className="w-full rounded-lg border border-gray-200 py-2.5 pl-10 pr-3 text-sm outline-none transition-shadow focus:border-[var(--cyan)] focus:ring-2 focus:ring-[var(--cyan-20)]"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Senha</Label>
          {mode === 'login' && (
            <a href="/esqueci-senha" className="text-xs text-[var(--cyan-dark)] hover:underline">
              Esqueceu a senha?
            </a>
          )}
        </div>
        <div className="relative mt-1">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            required
            minLength={mode === 'signup' ? 8 : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-lg border border-gray-200 py-2.5 pl-10 pr-10 text-sm outline-none transition-shadow focus:border-[var(--cyan)] focus:ring-2 focus:ring-[var(--cyan-20)]"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {mode === 'signup' && <p className="mt-1 text-xs text-gray-400">Mínimo de 8 caracteres.</p>}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-[var(--navy-dark)] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--navy)] disabled:opacity-60"
      >
        {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
      </button>
    </form>
  )
}
