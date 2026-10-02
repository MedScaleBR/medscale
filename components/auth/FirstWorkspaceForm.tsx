'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { friendlyErrorMessage } from '@/lib/friendly-errors'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none transition-shadow focus:border-[var(--cyan)] focus:ring-2 focus:ring-[var(--cyan-20)]'

export function FirstWorkspaceForm() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', address: '', city: '', state: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Erro ao criar a unidade')
      setLoading(false)
      return
    }
    router.replace('/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Nome da unidade</Label>
        <input
          id="name"
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Ex: Consultório Centro"
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <Label htmlFor="address">Endereço</Label>
        <input
          id="address"
          value={form.address}
          onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          className={INPUT_CLASS}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="city">Cidade</Label>
          <input
            id="city"
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <Label htmlFor="state">Estado</Label>
          <input
            id="state"
            value={form.state}
            onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
            className={INPUT_CLASS}
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{friendlyErrorMessage(error, 'Não foi possível criar a unidade. Tente novamente.')}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-[var(--navy-dark)] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--navy)] disabled:opacity-60"
      >
        {loading ? 'Criando...' : 'Criar unidade e continuar'}
      </button>
    </form>
  )
}
