'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'
import { PostHogProvider as Provider } from 'posthog-js/react'
import { initPostHog } from '@/lib/analytics/posthog'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog()
  }, [])

  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return <>{children}</>

  return <Provider client={posthog}>{children}</Provider>
}
