'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function GoogleLoginButton({ redirectTo = '/dashboard' }: { redirectTo?: string }) {
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}` },
    })
  }

  return (
    <div className="relative">
      <span className="absolute -top-2.5 right-3 rounded-full bg-[var(--cyan)] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--navy-dark)] shadow-sm">
        RECOMENDADO
      </span>
      <button
        onClick={handleLogin}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-lg border-2 border-[var(--cyan)] bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-[0_0_0_3px_var(--cyan-10)] transition-colors hover:bg-[var(--cyan-10)] disabled:opacity-60"
      >
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46c-.28 1.5-1.13 2.78-2.4 3.63v3.02h3.88c2.27-2.09 3.58-5.17 3.58-8.84z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.94H1.28v3.11C3.25 21.3 7.31 24 12 24z"
          />
          <path
            fill="#FBBC05"
            d="M5.29 14.29a7.2 7.2 0 0 1 0-4.58V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.11z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.28 6.6l4.01 3.11C6.23 6.87 8.88 4.75 12 4.75z"
          />
        </svg>
        {loading ? 'Entrando...' : 'Continuar com Google'}
      </button>
    </div>
  )
}
