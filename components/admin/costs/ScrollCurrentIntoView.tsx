'use client'

import { useEffect } from 'react'

/** Rola a faixa até o item com aria-current="page" — o cliente escolhido pode estar fora da vista. */
export function ScrollCurrentIntoView({ containerId, selectedId }: { containerId: string; selectedId: string | null }) {
  useEffect(() => {
    document
      .getElementById(containerId)
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [containerId, selectedId])
  return null
}
