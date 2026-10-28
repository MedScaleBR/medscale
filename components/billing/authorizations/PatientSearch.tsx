'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'

export interface PatientHit {
  id: string
  full_name: string
}

// Busca de paciente com debounce de 300 ms em /api/patients?q=. Ao escolher,
// mostra o nome com "limpar".
export function PatientSearch({
  id,
  value,
  onChange,
}: {
  id: string
  value: PatientHit | null
  onChange: (patient: PatientHit | null) => void
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PatientHit[]>([])

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) return
    let cancelled = false
    const timer = setTimeout(() => {
      fetch(`/api/patients?${new URLSearchParams({ q: term })}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: PatientHit[] | null) => !cancelled && Array.isArray(d) && setHits(d.slice(0, 8)))
        .catch(() => {})
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q])

  if (value) {
    return (
      <div className="ph-no-capture ph-mask flex items-center justify-between rounded-lg border border-[var(--navy-06)] px-2.5 py-1.5 text-sm">
        <span className="truncate text-gray-900">{value.full_name}</span>
        <button
          type="button"
          className="ml-2 shrink-0 text-xs text-[var(--cyan-dark)] underline"
          onClick={() => {
            onChange(null)
            setQ('')
            setHits([])
          }}
        >
          limpar
        </button>
      </div>
    )
  }

  const showHits = q.trim().length >= 2 && hits.length > 0
  return (
    <div className="ph-no-capture ph-mask relative">
      <Input id={id} value={q} placeholder="Buscar paciente por nome ou telefone" onChange={(e) => setQ(e.target.value)} />
      {showHits && (
        <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-[var(--navy-06)] bg-white text-sm shadow-[var(--shadow-sm)]">
          {hits.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left hover:bg-[var(--navy-06)]/40"
                onClick={() => {
                  onChange(p)
                  setQ('')
                  setHits([])
                }}
              >
                {p.full_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
