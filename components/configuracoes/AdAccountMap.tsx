'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface AdAccountMapRow {
  id: string
  name: string
  adAccountId: string | null
}

interface AdAccount {
  id: string
  name: string
}

const NONE = '__none__'

export function AdAccountMap({ workspaces }: { workspaces: AdAccountMapRow[] }) {
  const [accounts, setAccounts] = useState<AdAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, string | null>>(
    () => Object.fromEntries(workspaces.map((w) => [w.id, w.adAccountId]))
  )
  const [savingId, setSavingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})

  const loadAccounts = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/meta/ads/accounts')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao listar contas de anúncio.')
      setAccounts(json.adAccounts ?? [])
    } catch (err) {
      setLoadError(String(err instanceof Error ? err.message : err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAccounts()
  }, [])

  const items = useMemo(() => {
    const map: Record<string, string> = { [NONE]: 'Nenhuma' }
    for (const a of accounts) map[a.id] = a.name
    return map
  }, [accounts])

  const onChange = async (workspaceId: string, value: string) => {
    setSavingId(workspaceId)
    setRowError((e) => ({ ...e, [workspaceId]: '' }))
    try {
      const adAccountId = value === NONE ? null : value
      const adAccountName = adAccountId ? (accounts.find((a) => a.id === adAccountId)?.name ?? null) : null

      const res = await fetch('/api/meta/ads/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, ad_account_id: adAccountId, ad_account_name: adAccountName }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Não foi possível salvar.')

      setMapping((m) => ({ ...m, [workspaceId]: json.adAccountId ?? null }))
    } catch (err) {
      setRowError((e) => ({ ...e, [workspaceId]: String(err instanceof Error ? err.message : err) }))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-900">Conta de anúncio por unidade</h3>
      <p className="mt-0.5 text-xs text-gray-400">
        Qual conta de anúncio do Facebook representa cada unidade. As campanhas dessa conta entram
        nos relatórios da unidade escolhida.
      </p>

      {loadError && <p className="mt-3 text-xs text-red-500">{loadError}</p>}
      {loading && <p className="mt-3 text-xs text-gray-400">Carregando contas de anúncio…</p>}

      {!loading && (
        <div className="mt-3 space-y-2">
          {workspaces.map((w) => {
            const current = mapping[w.id]
            const value = current ?? NONE
            return (
              <div key={w.id} className="flex flex-wrap items-center gap-2">
                <span className="w-40 shrink-0 truncate text-xs font-medium text-gray-600">{w.name}</span>
                <Select
                  items={items}
                  value={value}
                  onValueChange={(v) => v && onChange(w.id, v)}
                  disabled={savingId === w.id}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nenhuma</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {savingId === w.id && <span className="text-xs text-gray-400">salvando…</span>}
                {rowError[w.id] && <span className="text-xs text-red-500">{rowError[w.id]}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
