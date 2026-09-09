'use client'

import { useRouter } from 'next/navigation'
import posthog from 'posthog-js'
import { createClient } from '@/lib/supabase/client'

// Logout compartilhado: usado pelo menu do avatar (Topbar) e pela linha
// "Sair" da gaveta mobile (MobileDrawerContent).
export function useLogout() {
  const router = useRouter()
  return async () => {
    const supabase = createClient()
    if (posthog.__loaded) posthog.reset()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }
}
