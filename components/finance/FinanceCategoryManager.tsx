'use client'

import { useCallback, useState } from 'react'
import type { JSX } from 'react'
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Gerenciador CRUD da árvore de categorias/subcategorias do financeiro,
// renderizado dentro da tela /finance. Recebe a árvore inicial (2 níveis, com
// contagem de lançamentos) já pronta do pai — que a deriva dos dados que o
// server component de /finance carregou — então não faz fetch no mount. Após
// cada mutação recarrega a própria lista via GET /api/finance/categories
// (estado local, para atualizar na hora) e chama onChanged() para o pai
// revalidar a árvore do servidor, que alimenta picker/tabela/gráfico.

export type NodeWithCount = {
  id: string
  name: string
  sortOrder: number
  isArchived: boolean
  entryCount: number
  children: NodeWithCount[]
}

// code de erro (400) → mensagem exibida. fallback cobre create/rename/move.
const CODE_MESSAGES: Record<string, string> = {
  duplicate_sibling: 'Já existe uma categoria com esse nome aqui.',
  empty_name: 'Dê um nome à categoria.',
  parent_not_root: 'Não dá para criar um 3º nível.',
}
const FALLBACK = 'Não foi possível salvar.'

const bySort = (a: NodeWithCount, b: NodeWithCount) => a.sortOrder - b.sortOrder

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

type DialogState =
  | { mode: 'create-root' }
  | { mode: 'create-sub'; parentId: string; parentName: string }
  | { mode: 'rename'; targetId: string; current: string }

export function FinanceCategoryManager({
  kind,
  initialData,
  onChanged,
}: {
  kind: 'pf' | 'pj'
  // Árvore inicial (com entryCount) para este kind, derivada pelo pai dos dados
  // já carregados pelo server component. O componente monta com ela — sem fetch.
  // FinanceClient passa key={kind}, então trocar de aba PF/PJ remonta com a
  // árvore do kind certo.
  initialData: NodeWithCount[]
  // Chamado após cada mutação bem-sucedida. FinanceClient passa router.refresh()
  // para revalidar a árvore renderizada no servidor (picker/tabela/gráfico dos
  // Lançamentos). O load() local continua — a lista deste componente precisa
  // atualizar na hora.
  onChanged?: () => void
}): JSX.Element {
  const [data, setData] = useState<NodeWithCount[]>(initialData)
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [nameValue, setNameValue] = useState('')

  // Recarrega a lista deste componente após uma mutação (o pai revalida o
  // resto via onChanged). Não roda no mount — initialData já cobre isso.
  const load = useCallback(async () => {
    const r = await fetch(`/api/finance/categories?kind=${kind}`)
    const j = (await r.json()) as Record<string, NodeWithCount[]>
    setData(j[kind] ?? [])
  }, [kind])

  // Dispara a requisição, trata erros conhecidos (400 por code, 409 in_use) e
  // devolve se deu certo. Sempre limpa o erro anterior antes de tentar.
  const send = async (url: string, init: RequestInit): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, init)
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          code?: string
          children?: number
          entries?: number
        }
        if (res.status === 409 && j.code === 'in_use') {
          setError(
            `Categoria em uso (${j.entries ?? 0} lançamentos, ${j.children ?? 0} subcategorias). Arquive em vez de excluir.`,
          )
        } else if (res.status === 400) {
          setError((j.code && CODE_MESSAGES[j.code]) || FALLBACK)
        } else {
          setError(FALLBACK)
        }
        return false
      }
      return true
    } finally {
      setBusy(false)
    }
  }

  const create = async (name: string, parentId?: string): Promise<boolean> => {
    const ok = await send(
      '/api/finance/categories',
      jsonInit('POST', { kind, name, parent_id: parentId ?? null }),
    )
    if (ok) {
      await load()
      onChanged?.()
    }
    return ok
  }

  const rename = async (id: string, name: string): Promise<boolean> => {
    const ok = await send(`/api/finance/categories/${id}`, jsonInit('PATCH', { name }))
    if (ok) {
      await load()
      onChanged?.()
    }
    return ok
  }

  const move = async (id: string, parentId: string): Promise<void> => {
    const ok = await send(`/api/finance/categories/${id}`, jsonInit('PATCH', { parent_id: parentId }))
    if (ok) {
      await load()
      onChanged?.()
    }
  }

  const archive = async (node: NodeWithCount, isRoot: boolean, value: boolean): Promise<void> => {
    if (isRoot && value && node.children.length > 0) {
      const proceed = window.confirm(
        `Arquivar "${node.name}" também esconde ${node.children.length} subcategoria(s). Continuar?`,
      )
      if (!proceed) return
    }
    const ok = await send(
      `/api/finance/categories/${node.id}`,
      jsonInit('PATCH', { is_archived: value }),
    )
    if (ok) {
      await load()
      onChanged?.()
    }
  }

  // Reordena trocando sort_order com o vizinho — dois PATCH { sort_order }.
  const reorder = async (
    list: NodeWithCount[],
    index: number,
    dir: 'up' | 'down',
  ): Promise<void> => {
    const target = dir === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= list.length) return
    const node = list[index]
    const neighbour = list[target]
    const ok1 = await send(
      `/api/finance/categories/${node.id}`,
      jsonInit('PATCH', { sort_order: neighbour.sortOrder }),
    )
    if (!ok1) return
    const ok2 = await send(
      `/api/finance/categories/${neighbour.id}`,
      jsonInit('PATCH', { sort_order: node.sortOrder }),
    )
    if (ok2) {
      await load()
      onChanged?.()
    }
  }

  const remove = async (id: string): Promise<void> => {
    const ok = await send(`/api/finance/categories/${id}`, { method: 'DELETE' })
    if (ok) {
      await load()
      onChanged?.()
    }
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openCreateRoot = () => {
    setNameValue('')
    setDialog({ mode: 'create-root' })
  }
  const openCreateSub = (parent: NodeWithCount) => {
    setNameValue('')
    setDialog({ mode: 'create-sub', parentId: parent.id, parentName: parent.name })
  }
  const openRename = (node: NodeWithCount) => {
    setNameValue(node.name)
    setDialog({ mode: 'rename', targetId: node.id, current: node.name })
  }

  const submitDialog = async () => {
    if (!dialog) return
    const name = nameValue.trim()
    if (!name) {
      setError(CODE_MESSAGES.empty_name)
      return
    }
    let ok = false
    if (dialog.mode === 'create-root') ok = await create(name)
    else if (dialog.mode === 'create-sub') ok = await create(name, dialog.parentId)
    else ok = await rename(dialog.targetId, name)
    if (ok) setDialog(null)
  }

  const roots = [...data].sort(bySort)
  const visibleRoots = roots.filter((n) => showArchived || !n.isArchived)
  const moveTargets = roots.filter((n) => !n.isArchived)

  const dialogTitle =
    dialog?.mode === 'rename'
      ? 'Renomear'
      : dialog?.mode === 'create-sub'
        ? `Nova subcategoria em "${dialog.parentName}"`
        : 'Nova categoria'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          onClick={openCreateRoot}
          disabled={busy}
          className="gap-2 bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
        >
          <Plus className="h-4 w-4" />
          Nova categoria
        </Button>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Mostrar arquivadas
        </label>
      </div>

      {error && !dialog && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            className="text-red-400 hover:text-red-600"
            onClick={() => setError(null)}
            aria-label="Fechar aviso"
          >
            ×
          </button>
        </div>
      )}

      <div className="divide-y divide-[var(--navy-06)] overflow-hidden rounded-xl border border-[var(--navy-06)] bg-white shadow-[var(--shadow-sm)]">
        {visibleRoots.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Nenhuma categoria ainda.</p>
        ) : (
          visibleRoots.map((root, i) => {
            const isOpen = expanded.has(root.id)
            const children = [...root.children]
              .sort(bySort)
              .filter((c) => showArchived || !c.isArchived)
            return (
              <div key={root.id} className={root.isArchived ? 'opacity-50' : undefined}>
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-left text-sm font-medium text-gray-900"
                    onClick={() => toggleExpand(root.id)}
                  >
                    {root.children.length > 0 ? (
                      isOpen ? (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      )
                    ) : (
                      <span className="inline-block h-4 w-4" />
                    )}
                    {root.name}
                    <span className="text-xs font-normal text-gray-400">({root.entryCount})</span>
                  </button>

                  <div className="ml-auto flex flex-wrap items-center gap-1">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => openRename(root)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Renomear
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => openCreateSub(root)}
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                      Subcategoria
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void archive(root, true, !root.isArchived)}
                    >
                      {root.isArchived ? (
                        <>
                          <ArchiveRestore className="h-3.5 w-3.5" />
                          Reativar
                        </>
                      ) : (
                        <>
                          <Archive className="h-3.5 w-3.5" />
                          Arquivar
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || i === 0}
                      title="Mover para cima"
                      onClick={() => void reorder(visibleRoots, i, 'up')}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || i === visibleRoots.length - 1}
                      title="Mover para baixo"
                      onClick={() => void reorder(visibleRoots, i, 'down')}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      title="Excluir"
                      onClick={() => void remove(root.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                </div>

                {isOpen && children.length > 0 && (
                  <div className="divide-y divide-[var(--navy-06)] border-t border-[var(--navy-06)] bg-[var(--navy-06)]/20">
                    {children.map((child) => (
                      <div
                        key={child.id}
                        className={`flex flex-wrap items-center gap-2 py-2 pr-4 pl-10 ${
                          child.isArchived ? 'opacity-50' : ''
                        }`}
                      >
                        <span className="text-sm text-gray-800">{child.name}</span>
                        <span className="text-xs text-gray-400">({child.entryCount})</span>
                        <div className="ml-auto flex flex-wrap items-center gap-1">
                          <label className="flex items-center gap-1 text-xs text-gray-500">
                            Mover
                            <select
                              className="rounded-lg border border-[var(--navy-06)] bg-white px-2 py-1 text-xs text-gray-600"
                              value={root.id}
                              disabled={busy}
                              onChange={(e) => {
                                if (e.target.value !== root.id) void move(child.id, e.target.value)
                              }}
                            >
                              {moveTargets.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => openRename(child)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Renomear
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => void archive(child, false, !child.isArchived)}
                          >
                            {child.isArchived ? (
                              <>
                                <ArchiveRestore className="h-3.5 w-3.5" />
                                Reativar
                              </>
                            ) : (
                              <>
                                <Archive className="h-3.5 w-3.5" />
                                Arquivar
                              </>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={busy}
                            title="Excluir"
                            onClick={() => void remove(child.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={nameValue}
            placeholder="Nome da categoria"
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitDialog()
            }}
          />
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              onClick={() => void submitDialog()}
              disabled={busy || !nameValue.trim()}
              className="bg-[var(--cyan)] text-[var(--navy-dark)] hover:bg-[var(--cyan-dark)]"
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
