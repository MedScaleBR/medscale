'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FinanceCategoryManager, type NodeWithCount } from './FinanceCategoryManager'

// O gerenciador de categorias saiu da navegação principal: virou um diálogo
// atrás do botão "Categorias". A tela agora é um painel só, sem abas de nível
// superior, então gerenciar categoria é uma tarefa pontual — não uma "vista".
export function FinanceCategoriesDialog({
  open, onOpenChange, kind, data, onChanged,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  kind: 'pf' | 'pj'
  data: NodeWithCount[]
  onChanged: () => void
}) {
  const [direction, setDirection] = useState<'out' | 'in'>('out')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Categorias de {kind === 'pf' ? 'PF' : 'PJ'}</DialogTitle>
        </DialogHeader>

        <Tabs value={direction} onValueChange={(v) => setDirection(v as 'out' | 'in')}>
          <TabsList>
            <TabsTrigger value="out">Despesas</TabsTrigger>
            <TabsTrigger value="in">Receitas</TabsTrigger>
          </TabsList>
        </Tabs>

        <FinanceCategoryManager
          key={`${kind}-${direction}`}
          kind={kind}
          direction={direction}
          initialData={data.filter((n) => n.direction === direction)}
          onChanged={onChanged}
        />
      </DialogContent>
    </Dialog>
  )
}
