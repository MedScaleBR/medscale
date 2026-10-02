'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { friendlyErrorMessage } from '@/lib/friendly-errors'
import type { AccountTaskSourceType } from '@/types/database'

interface ConvertToTaskButtonProps {
  sourceType: AccountTaskSourceType
  sourceRef: string
  title: string
  /** Texto completo da origem (ex.: a mensagem do feedback), salvo na descrição da tarefa. */
  description?: string
  accountId: string | null
  /** Já existe tarefa com este source_ref (vem de getTaskedRefs no servidor). */
  initialTasked: boolean
}

// Cria a tarefa vinculada à origem (alerta de custo ou feedback). O POST é
// idempotente: 201 cria, 200 devolve a que já existia — os dois são sucesso.
export function ConvertToTaskButton({
  sourceType,
  sourceRef,
  title,
  description,
  accountId,
  initialTasked,
}: ConvertToTaskButtonProps) {
  const router = useRouter()
  const [tasked, setTasked] = useState(initialTasked)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (tasked) {
    return (
      <Badge
        render={<Link href="/admin/tasks" />}
        className="border-none bg-green-50 text-green-700 hover:underline [a]:hover:bg-green-50"
      >
        Na Entrada de Tarefas
      </Badge>
    )
  }

  const convert = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description ?? null,
          account_id: accountId,
          source_type: sourceType,
          source_ref: sourceRef,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? 'Não foi possível criar a tarefa.')
      }
      setTasked(true)
      router.refresh()
    } catch (err) {
      setError(friendlyErrorMessage(err, 'Não foi possível criar a tarefa. Tente novamente.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={convert} disabled={loading}>
        {loading ? 'Criando…' : 'Virar tarefa'}
      </Button>
      {error && (
        <p role="alert" className="max-w-56 text-right text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  )
}
