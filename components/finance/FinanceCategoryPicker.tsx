'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FinanceCategoryTree } from '@/lib/finance/categories'

const NONE = '__none__'

export function FinanceCategoryPicker({
  kind, tree, categoryId, subcategoryId, onChange, disabled,
}: {
  kind: 'pf' | 'pj'
  tree: FinanceCategoryTree
  categoryId: string | null
  subcategoryId: string | null
  onChange: (next: { categoryId: string | null; subcategoryId: string | null }) => void
  disabled?: boolean
}) {
  const roots = tree[kind].filter((c) => !c.isArchived)
  const current = roots.find((c) => c.id === categoryId) ?? null
  const subs = (current?.children ?? []).filter((s) => !s.isArchived)

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs text-gray-400">Categoria</label>
        <Select
          value={categoryId ?? NONE}
          disabled={disabled}
          onValueChange={(v) => onChange({ categoryId: v === NONE ? null : v, subcategoryId: null })}
        >
          <SelectTrigger><SelectValue placeholder="Sem categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Sem categoria</SelectItem>
            {roots.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {subs.length > 0 && (
        <div>
          <label className="mb-1 block text-xs text-gray-400">Subcategoria</label>
          <Select
            value={subcategoryId ?? NONE}
            disabled={disabled}
            onValueChange={(v) => onChange({ categoryId, subcategoryId: v === NONE ? null : v })}
          >
            <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nenhuma</SelectItem>
              {subs.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
